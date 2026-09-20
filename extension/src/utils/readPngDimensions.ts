import { IMAGE_LIMIT_BYTES, MAX_RECORDING_DIMENSION_PX, PNG_HEADER_BYTES, PNG_HEIGHT_OFFSET, PNG_SIGNATURE_HEX, PNG_WIDTH_OFFSET } from '../constants';

/** Rejects oversized or implausible recorded PNGs before {@link RecordingWriter} admits bytes or playback decodes them. @example readPngDimensions(png).width // 720 */
export function readPngDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.byteLength < PNG_HEADER_BYTES || bytes.byteLength > IMAGE_LIMIT_BYTES || bytes.subarray(0, PNG_WIDTH_OFFSET).toString('hex') !== PNG_SIGNATURE_HEX) throw new Error('Recording frame is not a bounded PNG.');
  const width = bytes.readUInt32BE(PNG_WIDTH_OFFSET), height = bytes.readUInt32BE(PNG_HEIGHT_OFFSET);
  if (!width || !height || width > MAX_RECORDING_DIMENSION_PX || height > MAX_RECORDING_DIMENSION_PX) throw new Error('Recording frame dimensions exceed the decode limit.');
  return { width, height };
}
