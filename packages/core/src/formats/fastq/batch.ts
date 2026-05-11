import { createFastqRecord } from "@genotype/core/constructors";
import type { FastqBatch } from "@genotype/core/backend/types";
import { GenotypeString } from "@genotype/core/genotype-string";
import type { FastqSequence, QualityEncoding } from "@genotype/core/types";

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8");

export function packFastqBatch(sequences: readonly FastqSequence[]): FastqBatch {
  const nameChunks: Uint8Array[] = [];
  const descriptionChunks: Uint8Array[] = [];
  const sequenceChunks: Uint8Array[] = [];
  const qualityChunks: Uint8Array[] = [];
  const nameOffsets = [0];
  const descriptionOffsets = [0];
  const sequenceOffsets = [0];
  const qualityOffsets = [0];

  for (const sequence of sequences) {
    const name = utf8Encoder.encode(sequence.id);
    nameChunks.push(name);
    nameOffsets.push(nameOffsets[nameOffsets.length - 1]! + name.length);

    const description =
      sequence.description === undefined ? new Uint8Array(0) : utf8Encoder.encode(sequence.description);
    descriptionChunks.push(description);
    descriptionOffsets.push(
      descriptionOffsets[descriptionOffsets.length - 1]! + description.length
    );

    const sequenceBytes = sequence.sequence.toBytes();
    sequenceChunks.push(sequenceBytes);
    sequenceOffsets.push(sequenceOffsets[sequenceOffsets.length - 1]! + sequenceBytes.length);

    const qualityBytes = sequence.quality.toBytes();
    qualityChunks.push(qualityBytes);
    qualityOffsets.push(qualityOffsets[qualityOffsets.length - 1]! + qualityBytes.length);
  }

  return {
    count: sequences.length,
    nameData: concatBytes(nameChunks),
    nameOffsets: new Uint32Array(nameOffsets),
    descriptionData: concatBytes(descriptionChunks),
    descriptionOffsets: new Uint32Array(descriptionOffsets),
    sequenceData: concatBytes(sequenceChunks),
    sequenceOffsets: new Uint32Array(sequenceOffsets),
    qualityData: concatBytes(qualityChunks),
    qualityOffsets: new Uint32Array(qualityOffsets),
  };
}

export function* unpackFastqBatch(
  batch: FastqBatch,
  qualityEncoding: QualityEncoding
): Iterable<FastqSequence> {
  for (let index = 0; index < batch.count; index++) {
    const nameStart = batch.nameOffsets[index]!;
    const nameEnd = batch.nameOffsets[index + 1]!;
    const descriptionStart = batch.descriptionOffsets[index]!;
    const descriptionEnd = batch.descriptionOffsets[index + 1]!;
    const sequenceStart = batch.sequenceOffsets[index]!;
    const sequenceEnd = batch.sequenceOffsets[index + 1]!;
    const qualityStart = batch.qualityOffsets[index]!;
    const qualityEnd = batch.qualityOffsets[index + 1]!;

    const description =
      descriptionEnd > descriptionStart
        ? utf8Decoder.decode(batch.descriptionData.subarray(descriptionStart, descriptionEnd))
        : undefined;

    yield createFastqRecord({
      id: utf8Decoder.decode(batch.nameData.subarray(nameStart, nameEnd)),
      sequence: GenotypeString.fromBytes(batch.sequenceData.subarray(sequenceStart, sequenceEnd)),
      quality: GenotypeString.fromBytes(batch.qualityData.subarray(qualityStart, qualityEnd)),
      qualityEncoding,
      description,
    });
  }
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
