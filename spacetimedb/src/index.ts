import { spacetimedb } from "./schema";

// The module entry: the schema object is the default export the host
// loads; the registration files are re-exported so their views are
// part of the module. Nothing else registers anything (ADR 0031's
// layout rule, translated from ADR 0020): top-level files of src/
// register, lib/ and format/ are libraries.
export default spacetimedb;
export * from "./auth";
export * from "./share";
export * from "./tournaments";
