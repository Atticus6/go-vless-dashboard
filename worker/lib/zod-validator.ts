// You should NOT make any changes in this file as it will be overwritten.
/* eslint-disable @typescript-eslint/no-explicit-any */
/** biome-ignore-all lint/suspicious/noConfusingVoidType: 源代码 不需要修改 */
/** biome-ignore-all lint/complexity/noBannedTypes: 源代码 不需要修改 */
import type {
  Context,
  Env,
  Input,
  MiddlewareHandler,
  TypedResponse,
} from "hono";
import type { FormValue, ParsedFormValue, ValidationTargets } from "hono/types";
import type { UnionToIntersection } from "hono/utils/types";
import { validator } from "hono/validator";
import type * as v3 from "zod/v3";
import type { ZodSafeParseResult as v4ZodSafeParseResult } from "zod/v4";
import type * as v4 from "zod/v4/core";

/**
 * Checks if T is a literal union type (e.g., 'asc' | 'desc')
 * that should be preserved in input types.
 * Returns true for union literals, false for single literals or wide types.
 */
type IsLiteralUnion<T, Base> = [Exclude<T, undefined>] extends [Base]
  ? [Exclude<T, undefined>] extends [UnionToIntersection<Exclude<T, undefined>>]
  ? false
  : true
  : false;

// Check if type is an optional union (T | undefined) but not unknown/any
type IsOptionalUnion<T> = [unknown] extends [T]
  ? false // unknown or any
  : undefined extends T
  ? true
  : false;

// Helper to force TypeScript to expand type aliases
type SimplifyDeep<T> = { [K in keyof T]: T[K] } & {};

type InferInputInner<
  Output,
  Target extends keyof ValidationTargets,
  T extends FormValue,
> = SimplifyDeep<{
  [K in keyof Output]: IsLiteralUnion<Output[K], string> extends true
  ? Output[K]
  : IsOptionalUnion<Output[K]> extends true
  ? Output[K]
  : Target extends "form"
  ? T | T[]
  : Target extends "query"
  ? string | string[]
  : Target extends "param"
  ? string
  : Target extends "header"
  ? string
  : Target extends "cookie"
  ? string
  : unknown;
}>;

/**
 * Utility type to infer input types for validation targets.
 * Preserves literal union types (e.g., 'asc' | 'desc') while using
 * the default ValidationTargets type for other values.
 *
 * @example
 * ```ts
 * // In @hono/zod-validator or similar:
 * type Input = InferInput<z.input<Schema>, 'query'>
 * // { orderBy: 'asc' | 'desc', page: string | string[] }
 * ```
 */
type InferInput<
  Output,
  Target extends keyof ValidationTargets,
  T extends FormValue = ParsedFormValue,
> = [Exclude<Output, undefined>] extends [never]
  ? {}
  : [Exclude<Output, undefined>] extends [object]
  ? undefined extends Output
  ?
  | SimplifyDeep<InferInputInner<Exclude<Output, undefined>, Target, T>>
  | undefined
  : SimplifyDeep<InferInputInner<Output, Target, T>>
  : {};

type ZodSchema = v3.ZodType | v4.$ZodType;
type ZodError<T extends ZodSchema> = T extends v4.$ZodType
  ? v4.$ZodError<v4.output<T>>
  : v3.ZodError;
type ZodSafeParseResult<T, T2, T3 extends ZodSchema> = T3 extends v4.$ZodType
  ? v4ZodSafeParseResult<T>
  : v3.SafeParseReturnType<T, T2>;
type zInput<T> = T extends v3.ZodType
  ? v3.input<T>
  : T extends v4.$ZodType
  ? v4.input<T>
  : never;
type zOutput<T> = T extends v3.ZodType
  ? v3.output<T>
  : T extends v4.$ZodType
  ? v4.output<T>
  : never;
type zInfer<T> = T extends v3.ZodType
  ? v3.infer<T>
  : T extends v4.$ZodType
  ? v4.infer<T>
  : never;

export type Hook<
  T,
  E extends Env,
  P extends string,
  Target extends keyof ValidationTargets = keyof ValidationTargets,
  O = {},
  Schema extends ZodSchema = any,
> = (
  result: (
    | { success: true; data: T }
    | { success: false; error: ZodError<Schema>; data: T }
  ) & {
    target: Target;
  },
  c: Context<E, P>,
) =>
    | Response
    | void
    | TypedResponse<O>
    | Promise<Response | void | TypedResponse<O>>;

type HasUndefined<T> = undefined extends T ? true : false;

type ExtractValidationResponse<VF> = VF extends (value: any, c: any) => infer R
  ? R extends Promise<infer PR>
  ? PR extends TypedResponse<infer T, infer S, infer F>
  ? TypedResponse<T, S, F>
  : PR extends Response
  ? PR
  : PR extends undefined
  ? never
  : never
  : R extends TypedResponse<infer T, infer S, infer F>
  ? TypedResponse<T, S, F>
  : R extends Response
  ? R
  : R extends undefined
  ? never
  : never
  : never;

type DefaultInput<Target extends keyof ValidationTargets, In, Out> = {
  in: HasUndefined<In> extends true
  ? {
    [K in Target]?: [In] extends [ValidationTargets[K]]
    ? In
    : InferInput<In, K>;
  }
  : {
    [K in Target]: [In] extends [ValidationTargets[K]]
    ? In
    : InferInput<In, K>;
  };
  out: { [K in Target]: Out };
};

// without hook and options
function zValidatorFunction<
  T extends ZodSchema,
  Target extends keyof ValidationTargets,
  E extends Env,
  P extends string,
  In = zInput<T>,
  Out = zOutput<T>,
  I extends Input = DefaultInput<Target, In, Out>,
  V extends I = I,
>(target: Target, schema: T): MiddlewareHandler<E, P, V>;

// with hook and options
function zValidatorFunction<
  T extends ZodSchema,
  Target extends keyof ValidationTargets,
  E extends Env,
  P extends string,
  HookFn extends Hook<InferredValue, E, P, Target, {}, T>,
  In = zInput<T>,
  Out = zOutput<T>,
  I extends Input = DefaultInput<Target, In, Out>,
  V extends I = I,
  InferredValue = zInfer<T>,
>(
  target: Target,
  schema: T,
  hook?: HookFn,
  options?: {
    validationFunction: (
      schema: T,
      value: ValidationTargets[Target],
    ) =>
      | ZodSafeParseResult<any, any, T>
      | Promise<ZodSafeParseResult<any, any, T>>;
  },
): MiddlewareHandler<E, P, V, ExtractValidationResponse<HookFn>>;

// implementation
function zValidatorFunction<
  T extends ZodSchema,
  Target extends keyof ValidationTargets,
  E extends Env,
  P extends string,
  HookFn extends Hook<InferredValue, E, P, Target, {}, T>,
  In = zInput<T>,
  Out = zOutput<T>,
  I extends Input = DefaultInput<Target, In, Out>,
  V extends I = I,
  InferredValue = zInfer<T>,
>(
  target: Target,
  schema: T,
  hook?: HookFn,
  options?: {
    validationFunction: (
      schema: T,
      value: ValidationTargets[Target],
    ) =>
      | ZodSafeParseResult<any, any, T>
      | Promise<ZodSafeParseResult<any, any, T>>;
  },
):
  | MiddlewareHandler<E, P, V>
  | MiddlewareHandler<E, P, V, ExtractValidationResponse<HookFn>> {
  // @ts-expect-error not typed well
  return validator(target, async (value: ValidationTargets[Target], c) => {
    let validatorValue = value;

    // in case where our `target` === `header`, Hono parses all of the headers into lowercase.
    // this might not match the Zod schema, so we want to make sure that we account for that when parsing the schema.
    if (
      (target === "header" && "_def" in schema) ||
      (target === "header" && "_zod" in schema)
    ) {
      // create an object that maps lowercase schema keys to lowercase

      const schemaKeys = Object.keys(
        // @ts-expect-error
        "in" in schema ? schema.in.shape : schema.shape,
      );
      const caseInsensitiveKeymap = Object.fromEntries(
        schemaKeys.map((key) => [key.toLowerCase(), key]),
      );

      validatorValue = Object.fromEntries(
        Object.entries(value).map(([key, value]) => [
          caseInsensitiveKeymap[key] || key,
          value,
        ]),
      );
    }

    const result = options?.validationFunction
      ? await options.validationFunction(schema, validatorValue)
      : // @ts-expect-error z4.$ZodType has safeParseAsync
      await schema.safeParseAsync(validatorValue);

    if (hook) {
      const hookResult = await hook(
        { data: validatorValue, ...result, target },
        c,
      );
      if (hookResult) {
        if (hookResult instanceof Response) {
          return hookResult;
        }

        if ("response" in hookResult) {
          return hookResult.response;
        }
      }
    }

    if (!result.success) {
      return c.json(result, 400);
    }

    return result.data as zInfer<T>;
  });
}

export const zValidator: typeof zValidatorFunction = zValidatorFunction;
