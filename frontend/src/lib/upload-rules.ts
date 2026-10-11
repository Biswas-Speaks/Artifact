export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 10;
export function validateUploads(files: Pick<File, 'size' | 'name'>[]) {
  if (files.length > MAX_UPLOAD_FILES) return 'Choose up to 10 files at a time.';
  const oversized = files.find(f => f.size > MAX_UPLOAD_BYTES);
  return oversized ? `${oversized.name} exceeds the 20 MB limit.` : null;
}