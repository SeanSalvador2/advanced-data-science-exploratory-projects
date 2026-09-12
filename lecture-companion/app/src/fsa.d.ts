/**
 * The parts of the File System Access API that TypeScript's `lib.dom` does not
 * yet declare: the picker, the permission pair, async iteration of a directory,
 * `FileSystemFileHandle.move`, and `FileSystemObserver` (Chrome 133+).
 * Everything here is feature-detected at runtime before it is used.
 */

type FileSystemPermissionMode = "read" | "readwrite";

interface FileSystemHandlePermissionDescriptor {
  mode?: FileSystemPermissionMode;
}

interface FileSystemHandle {
  queryPermission?(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState>;
  requestPermission?(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState>;
}

interface FileSystemDirectoryHandle {
  keys(): AsyncIterableIterator<string>;
  values(): AsyncIterableIterator<FileSystemHandle>;
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemHandle]>;
}

interface FileSystemFileHandle {
  /** Chrome 113+. Rename, or move into another directory. */
  move?(name: string): Promise<void>;
  move?(parent: FileSystemDirectoryHandle, name?: string): Promise<void>;
}

interface DirectoryPickerOptions {
  id?: string;
  mode?: FileSystemPermissionMode;
  startIn?: string | FileSystemHandle;
}

interface Window {
  showDirectoryPicker?(
    options?: DirectoryPickerOptions,
  ): Promise<FileSystemDirectoryHandle>;
}

declare function showDirectoryPicker(
  options?: DirectoryPickerOptions,
): Promise<FileSystemDirectoryHandle>;

interface FileSystemChangeRecord {
  readonly root: FileSystemHandle;
  readonly changedHandle: FileSystemHandle;
  readonly relativePathComponents: readonly string[];
  readonly type:
    | "appeared"
    | "disappeared"
    | "modified"
    | "moved"
    | "unknown"
    | "errored";
}

declare class FileSystemObserver {
  constructor(
    callback: (
      records: FileSystemChangeRecord[],
      observer: FileSystemObserver,
    ) => void,
  );
  observe(
    handle: FileSystemHandle,
    options?: { recursive?: boolean },
  ): Promise<void>;
  unobserve(handle: FileSystemHandle): void;
  disconnect(): void;
}
