/** Compares native editor text for {@link StudyWorkspace}, {@link RepositoryReader} and source guards without changing retained byte hashes. @example normalizeNativeSourceText('\uFEFFx\r\n') // 'x\n' */
export function normalizeNativeSourceText(text: string): string { return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'); }
