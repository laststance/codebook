import { BOOK_STORAGE_FORMATS } from '../constants'
import { bookIdSchema } from '../identitySchemas'

/**
 * Reads the book id from the name of a file of the learning directory, so that only a file a book owns is listed and counted; called by `entries()` of {@link RepositoryBookStore} for every file of the directory.
 * @param fileName - The name of a file in the learning directory.
 * @returns
 * - The book id, for a book id followed by the suffix of a book storage format ({@link BOOK_STORAGE_FORMATS})
 * - `undefined` for any other name, also one with a book suffix whose prefix is no book id (a stray `X.book.v1.json`)
 * @example
 * bookIdOfFileName('architecture.book.v2.json') // => 'architecture'
 * bookIdOfFileName('X.book.v1.json')            // => undefined
 * bookIdOfFileName('writer.lock')               // => undefined
 */
export function bookIdOfFileName(fileName: string): string | undefined {
  const storage = BOOK_STORAGE_FORMATS.find((format) =>
    fileName.endsWith(format.suffix),
  )
  // A name without a book suffix is no book's; a prefix that is no book id parses to no data.
  return (
    storage &&
    bookIdSchema.safeParse(fileName.slice(0, -storage.suffix.length)).data
  )
}
