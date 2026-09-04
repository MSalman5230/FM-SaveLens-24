use crate::{Error, Result};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
    time::SystemTime,
};
use tokio_util::sync::CancellationToken;

pub fn check(cancel: &CancellationToken) -> Result<()> {
    if cancel.is_cancelled() {
        Err(Error::new("CANCELLED", "Import cancelled"))
    } else {
        Ok(())
    }
}

pub fn decompress(bytes: &[u8], limit: usize, cancel: &CancellationToken) -> Result<Vec<u8>> {
    let mut decoder = zstd::stream::read::Decoder::new(bytes)
        .map_err(|_| Error::new("CORRUPT_COMPRESSION", "The save could not be decompressed."))?;
    let mut output = Vec::new();
    let mut chunk = vec![0; 1024 * 1024];
    loop {
        check(cancel)?;
        let n = decoder.read(&mut chunk).map_err(|_| {
            Error::new("CORRUPT_COMPRESSION", "The save could not be decompressed.")
        })?;
        if n == 0 {
            break;
        }
        if n > limit.saturating_sub(output.len()) {
            return Err(Error::new(
                "INVALID_SIZE",
                "Decompressed data exceeds the supported size.",
            ));
        }
        output.extend_from_slice(&chunk[..n]);
    }
    Ok(output)
}

struct Cursor<'a> {
    bytes: &'a [u8],
    pos: usize,
}
impl<'a> Cursor<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        let end = self
            .pos
            .checked_add(n)
            .filter(|&e| e <= self.bytes.len())
            .ok_or_else(|| Error::new("TRUNCATED", "The save contains an incomplete record."))?;
        let b = &self.bytes[self.pos..end];
        self.pos = end;
        Ok(b)
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn text(&mut self) -> Result<String> {
        let n = self.u32()? as usize;
        if n > 16384 {
            return Err(Error::new(
                "INVALID_MANIFEST",
                "An archive name has an invalid length.",
            ));
        }
        Ok(String::from_utf8_lossy(self.take(n)?).into_owned())
    }
}

pub struct Member {
    pub name: String,
    pub offset: u64,
    pub stored: u64,
    pub plain: u64,
}
pub struct Archive {
    file: File,
    size: u64,
    modified: SystemTime,
    compressed: bool,
    pub name: String,
    pub members: Vec<Member>,
}
impl Archive {
    pub fn open(path: &Path, cancel: &CancellationToken) -> Result<Self> {
        let file = File::open(path)?;
        let stat = file.metadata()?;
        let mut a = Self {
            file,
            size: stat.len(),
            modified: stat.modified()?,
            compressed: false,
            name: String::new(),
            members: vec![],
        };
        let h = a.read(0, 26, cancel)?;
        if &h[..6] != b"\x02\x01fmf." || h[6] != 8 {
            return Err(Error::new(
                "UNSUPPORTED_FORMAT",
                "This file is not a supported FM24 save archive.",
            ));
        }
        if h[25] != 0 && h[25] != 3 {
            return Err(Error::new(
                "UNSUPPORTED_COMPRESSION",
                "This save uses an unsupported compression method.",
            ));
        }
        a.compressed = h[25] == 3;
        let start = u64::from_le_bytes(h[9..17].try_into().unwrap())
            .checked_add(9)
            .ok_or_else(|| Error::new("INVALID_SIZE", "Invalid archive index offset."))?;
        let header = a.read(start, 13, cancel)?;
        if &header[..9] != b"\x02\x01fmf.\x08\0\0" || &header[9..] != b"\x28\xb5\x2f\xfd" {
            return Err(Error::new(
                "INVALID_MANIFEST",
                "The save index is missing or incomplete. Try a completed backup save.",
            ));
        }
        let tail = a.size - start - 9;
        if tail > 32 * 1024 * 1024 {
            return Err(Error::new(
                "INVALID_MANIFEST",
                "The save index exceeds the supported size.",
            ));
        }
        let bytes = decompress(&a.read(start + 9, tail, cancel)?, 64 * 1024 * 1024, cancel)?;
        let mut c = Cursor {
            bytes: &bytes,
            pos: 0,
        };
        a.name = c.text()?;
        a.group(&mut c, "", start, cancel)?;
        let groups = c.u32()?;
        if groups > 10000 {
            return Err(Error::new("INVALID_MANIFEST", "Invalid archive groups."));
        }
        for _ in 0..groups {
            let prefix = c.text()? + "/";
            a.group(&mut c, &prefix, start, cancel)?;
        }
        if !a.members.iter().any(|m| m.name == "game_db.dat") {
            return Err(Error::new(
                "MISSING_DATABASE",
                "The save does not contain a player database.",
            ));
        }
        Ok(a)
    }
    fn group(
        &mut self,
        c: &mut Cursor<'_>,
        prefix: &str,
        start: u64,
        cancel: &CancellationToken,
    ) -> Result<()> {
        let count = c.u32()?;
        if count > 100000 {
            return Err(Error::new(
                "INVALID_MANIFEST",
                "Invalid number of archive members.",
            ));
        }
        for _ in 0..count {
            check(cancel)?;
            let mut name = prefix.to_string();
            let mut complete = false;
            for _ in 0..20 {
                let part = c.text()?;
                name.push_str(&part);
                if part.starts_with('.') {
                    complete = true;
                    break;
                }
            }
            if !complete {
                return Err(Error::new(
                    "INVALID_MANIFEST",
                    "Invalid archive member name.",
                ));
            }
            let offset = c.u64()?;
            let stored = c.u64()?;
            let plain = c.u64()?;
            c.take(16)?;
            if offset
                .checked_add(stored)
                .and_then(|v| v.checked_add(26))
                .is_none_or(|v| v > start)
                || plain > 2 * 1024u64.pow(3)
            {
                return Err(Error::new(
                    "INVALID_SIZE",
                    "A save member has invalid bounds or exceeds 2 GB.",
                ));
            }
            self.members.push(Member {
                name,
                offset,
                stored,
                plain,
            });
        }
        Ok(())
    }
    fn read(&mut self, position: u64, length: u64, cancel: &CancellationToken) -> Result<Vec<u8>> {
        if position.checked_add(length).is_none_or(|v| v > self.size) {
            return Err(Error::new("TRUNCATED", "The save file is incomplete."));
        }
        let length = usize::try_from(length)
            .map_err(|_| Error::new("INVALID_SIZE", "Archive member is too large."))?;
        let mut b = vec![0; length];
        self.file.seek(SeekFrom::Start(position))?;
        for chunk in b.chunks_mut(1024 * 1024) {
            check(cancel)?;
            self.file.read_exact(chunk)?;
        }
        Ok(b)
    }
    pub fn member(&mut self, name: &str, cancel: &CancellationToken) -> Result<Vec<u8>> {
        let m = self
            .members
            .iter()
            .find(|m| m.name == name)
            .ok_or_else(|| Error::new("MISSING_MEMBER", format!("The save is missing {name}.")))?;
        let (offset, stored, plain) = (m.offset, m.stored, m.plain);
        let bytes = self.read(offset + 26, stored, cancel)?;
        let bytes = if self.compressed {
            decompress(&bytes, plain as usize, cancel)?
        } else {
            bytes
        };
        if bytes.len() as u64 != plain {
            return Err(Error::new(
                "INVALID_SIZE",
                format!("{name} has an unexpected size."),
            ));
        }
        Ok(bytes)
    }
    pub fn unchanged(&self) -> Result<bool> {
        let stat = self.file.metadata()?;
        Ok(stat.len() == self.size && stat.modified()? == self.modified)
    }
}
