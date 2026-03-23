/**
 * @genotype/tabular — Tabular data formats for genotype
 *
 * DSV parsing/writing and fx2tab sequence-to-table conversion.
 * JSON morphs and schemas stay in @genotype/core/formats/json.
 *
 * Importing this module augments SeqOps from @genotype/core with
 * tabular methods: toTabular, writeTSV, writeCSV, writeDSV,
 * writeJSON, writeJSONL.
 */

import "@genotype/tabular/seqops-ext";

export {
  CSVParser,
  CSVWriter,
  DSVParser,
  type DSVParserOptions,
  type DSVRecord,
  DSVWriter,
  type DSVWriterOptions,
  detectDelimiter,
  ExcelProtector,
  protectFromExcel,
  TSVParser,
  TSVWriter,
} from "@genotype/tabular/dsv";

export {
  type BasicColumnId,
  type BuiltInColumnId,
  type ColumnId,
  type Fx2TabOptions,
  type Fx2TabRow,
  fx2tab,
  type KernelMetricColumnId,
  type MetadataColumnId,
  rowsToStrings,
  type Tab2FxOptions,
  TabularOps,
  tab2fx,
  type TsComputedColumnId,
} from "@genotype/tabular/fx2tab";

export { CustomColumnError, Fx2TabError, TabularParseError } from "@genotype/tabular/errors";
