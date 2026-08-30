/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as format_doubleElimination from "../format/doubleElimination.js";
import type * as format_engine from "../format/engine.js";
import type * as format_errors from "../format/errors.js";
import type * as format_evaluate from "../format/evaluate.js";
import type * as format_index from "../format/index.js";
import type * as format_seeding from "../format/seeding.js";
import type * as format_singleElimination from "../format/singleElimination.js";
import type * as format_types from "../format/types.js";
import type * as tasks from "../tasks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  "format/doubleElimination": typeof format_doubleElimination;
  "format/engine": typeof format_engine;
  "format/errors": typeof format_errors;
  "format/evaluate": typeof format_evaluate;
  "format/index": typeof format_index;
  "format/seeding": typeof format_seeding;
  "format/singleElimination": typeof format_singleElimination;
  "format/types": typeof format_types;
  tasks: typeof tasks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  auth: import("@convex-dev/auth/core/_generated/component.js").ComponentApi<"auth">;
  authAnonymous: import("@convex-dev/auth/providers/anonymous/_generated/component.js").ComponentApi<"authAnonymous">;
};
