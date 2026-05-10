declare module "@genotype/engine-wasm" {
  const init: () => Promise<unknown> | unknown;
  export default init;
}
