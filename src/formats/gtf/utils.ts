/**
 * GTF format utilities and helper functions
 *
 * Provides utility functions for GTF format detection, feature counting,
 * and filtering operations with streaming architecture support.
 *
 * @module gtf/utils
 */

import { validateGtfStrand } from "./parser";
import type { GtfFeature } from "./types";

/**
 * Detect if string contains GTF format data
 *
 * @param data String data to analyze for GTF format
 * @returns True if data appears to contain valid GTF format
 *
 * @example
 * ```typescript
 * const isGtf = detectGtfFormat(fileContent);
 * if (isGtf) {
 *   const parser = new GtfParser();
 *   // ... parse GTF data
 * }
 * ```
 *
 * @public
 */
function detectGtfFormat(data: string): boolean {
  if (typeof data !== "string" || data.length === 0) {
    return false;
  }

  const lines = data
    .trim()
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !line.startsWith("#") && !line.startsWith("//");
    });

  if (lines.length === 0) return false;

  // Check first few lines for GTF characteristics
  for (const line of lines.slice(0, 3)) {
    const fields = line.split("\t");

    if (fields.length !== 9) return false;

    // Validate coordinates
    const startStr = fields[3];
    const endStr = fields[4];

    if (!startStr || !endStr) return false;

    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (Number.isNaN(start) || Number.isNaN(end) || start < 1 || end < start) {
      return false;
    }

    // Validate strand
    const strand = fields[6];
    if (!strand || !validateGtfStrand(strand)) {
      return false;
    }
  }

  return true;
}

/**
 * Count features in GTF data without full parsing
 *
 * @param data GTF format string data
 * @returns Number of non-comment, non-empty lines
 *
 * @example
 * ```typescript
 * const featureCount = countGtfFeatures(gtfContent);
 * console.log(`Found ${featureCount} features to process`);
 * ```
 *
 * @public
 */
function countGtfFeatures(data: string): number {
  if (typeof data !== "string") return 0;

  return data.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("//");
  }).length;
}

/**
 * Filter features by type with streaming architecture
 *
 * @param features Input feature stream to filter
 * @param featureTypes Array of feature types to include
 * @returns Filtered feature stream
 *
 * @example
 * ```typescript
 * const geneFeatures = filterFeaturesByType(allFeatures, ["gene"]);
 * for await (const gene of geneFeatures) {
 *   console.log(`Gene: ${gene.attributes.gene_name}`);
 * }
 * ```
 *
 * @public
 */
function filterFeaturesByType(
  features: AsyncIterable<GtfFeature>,
  featureTypes: string[],
): AsyncIterable<GtfFeature> {
  const typeSet = new Set(featureTypes);

  return {
    async *[Symbol.asyncIterator]() {
      for await (const feature of features) {
        if (typeSet.has(feature.feature)) {
          yield feature;
        }
      }
    },
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export { detectGtfFormat, countGtfFeatures, filterFeaturesByType };
