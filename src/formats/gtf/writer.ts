/**
 * GTF format writer with enhanced output quality
 *
 * Provides GTF format writing capabilities with proper field formatting,
 * attribute quoting, and specification compliance.
 *
 * @module gtf/writer
 */

import type { GtfFeature } from "./types";

/**
 * GTF format writer with exceptional output quality
 *
 * @example Basic GTF writing
 * ```typescript
 * const writer = new GtfWriter();
 * const gtfLine = writer.formatFeature(feature);
 * console.log(gtfLine); // chr1\tHAVANA\tgene\t1000\t2000\t.\t+\t.gene_id "ENSG001";
 * ```
 *
 * @example Batch formatting
 * ```typescript
 * const gtfContent = writer.formatFeatures(features);
 * await Bun.write("output.gtf", gtfContent);
 * ```
 *
 * @public
 */
export class GtfWriter {
  /**
   * Format single GTF feature as tab-separated string
   *
   * @param feature GTF feature to format
   * @returns Properly formatted GTF line
   */
  formatFeature(feature: GtfFeature): string {
    const fields: string[] = [
      feature.seqname,
      feature.source,
      feature.feature,
      feature.start.toString(),
      feature.end.toString(),
      feature.score !== null ? feature.score.toString() : ".",
      feature.strand,
      feature.frame !== null ? feature.frame.toString() : ".",
      this.formatAttributes(feature.attributes),
    ];

    return fields.join("\t");
  }

  /**
   * Format attributes with GTF specification compliance
   *
   * @param attributes Attribute key-value pairs to format
   * @returns Properly quoted and separated attribute string
   */
  private formatAttributes(attributes: Record<string, string | string[]>): string {
    const parts: string[] = [];

    for (const [key, value] of Object.entries(attributes)) {
      if (Array.isArray(value)) {
        // Handle multiple values (e.g., multiple tags)
        for (const val of value) {
          const quotedValue = /[\s;"]/.test(val) ? `"${val}"` : val;
          parts.push(`${key} ${quotedValue}`);
        }
      } else {
        // Quote values that contain spaces or special characters per GTF spec
        const quotedValue = /[\s;"]/.test(value) ? `"${value}"` : value;
        parts.push(`${key} ${quotedValue}`);
      }
    }

    return parts.join("; ") + (parts.length > 0 ? ";" : "");
  }

  /**
   * Format multiple features as string
   *
   * @param features Array of GTF features to format
   * @returns Complete GTF format content
   */
  formatFeatures(features: GtfFeature[]): string {
    return features.map((feature) => this.formatFeature(feature)).join("\n");
  }

  /**
   * Write features to WritableStream
   *
   * @param features Async iterable of GTF features
   * @param stream Writable stream for output
   */
  async writeToStream(
    features: AsyncIterable<GtfFeature>,
    stream: WritableStream<Uint8Array>
  ): Promise<void> {
    const writer = stream.getWriter();
    const encoder = new TextEncoder();

    try {
      for await (const feature of features) {
        const formatted = this.formatFeature(feature) + "\n";
        await writer.write(encoder.encode(formatted));
      }
    } finally {
      writer.releaseLock();
    }
  }
}
