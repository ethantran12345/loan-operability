import type { IntakeFile } from '@/documents/intake'

const entryFile = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject))

async function folderFiles(folder: FileSystemDirectoryEntry): Promise<File[]> {
  const reader = folder.createReader()
  const found: File[] = []
  // readEntries hands back a batch at a time, and an empty batch when it is done.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (batch.length === 0) return found
    for (const entry of batch) {
      // Finder's own bookkeeping (.DS_Store) is not something the analyst put in the packet.
      if (entry.isFile && !entry.name.startsWith('.')) found.push(await entryFile(entry as FileSystemFileEntry))
    }
  }
}

/**
 * Every file in a drop. A folder dragged from Finder gives the files directly
 * inside it. Entries have to be taken before the first await: the browser empties
 * the DataTransfer as soon as the drop handler returns.
 */
export function filesFromDrop(data: DataTransfer): Promise<File[]> {
  const plain = Array.from(data.files)
  const entries = Array.from(data.items)
    .filter((item) => item.kind === 'file')
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
  if (!entries.some((e) => e?.isDirectory)) return Promise.resolve(plain)
  return Promise.all(
    entries.map(async (entry, i) => {
      if (entry?.isDirectory) return folderFiles(entry as FileSystemDirectoryEntry)
      if (entry?.isFile) return [await entryFile(entry as FileSystemFileEntry)]
      return plain[i] ? [plain[i]] : []
    }),
  ).then((groups) => groups.flat())
}

/** Read one file the analyst handed over. What is kept is the file's own text, and nothing else. */
export async function readIntakeFile(file: File): Promise<IntakeFile> {
  try {
    return { file: file.name, raw: await file.text(), size: file.size, source: 'dropped' }
  } catch {
    return { file: file.name, raw: '', size: file.size, source: 'dropped', unreadable: 'The browser could not read this as a text file.' }
  }
}
