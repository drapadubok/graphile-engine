// @flow
import type { Plugin } from "graphile-build";

export default (function PgComputedColumnsPlugin(
  builder,
  { pgSimpleCollections }
) {
  const hasConnections = pgSimpleCollections !== "only";
  const hasSimpleCollections =
    pgSimpleCollections === "only" || pgSimpleCollections === "both";

  builder.hook("GraphQLObjectType:fields", (fields, build, context) => {
    const {
      scope: {
        isPgRowType,
        isPgCompoundType,
        isInputType,
        pgIntrospection: table,
      },
      fieldWithHooks,
      Self,
    } = context;

    if (
      isInputType ||
      !(isPgRowType || isPgCompoundType) ||
      !table ||
      table.kind !== "class" ||
      !table.namespace
    ) {
      return fields;
    }

    const {
      extend,
      pgIntrospectionResultsByKind: introspectionResultsByKind,
      inflection,
      pgOmit: omit,
      pgMakeProcField: makeProcField,
      swallowError,
      describePgEntity,
      sqlCommentByAddingTags,
    } = build;
    const tableType = table.type;
    if (!tableType) {
      throw new Error("Could not determine the type for this table");
    }
    return extend(
      fields,
      introspectionResultsByKind.procedure.reduce((memo, proc) => {
        // PERFORMANCE: These used to be .filter(...) calls
        if (!proc.isStable) return memo;
        if (proc.namespaceId !== table.namespaceId) return memo;
        if (!proc.name.startsWith(`${table.name}_`)) return memo;
        if (proc.argTypeIds.length < 1) return memo;
        if (proc.argTypeIds[0] !== tableType.id) return memo;
        if (omit(proc, "execute")) return memo;

        const argTypes = proc.argTypeIds.reduce((prev, typeId, idx) => {
          if (
            proc.argModes.length === 0 || // all args are `in`
            proc.argModes[idx] === "i" || // this arg is `in`
            proc.argModes[idx] === "b" // this arg is `inout`
          ) {
            prev.push(introspectionResultsByKind.typeById[typeId]);
          }
          return prev;
        }, []);
        if (
          argTypes
            .slice(1)
            .some(
              type => type.type === "c" && type.class && type.class.isSelectable
            )
        ) {
          // Accepts two input tables? Skip.
          return memo;
        }

        const pseudoColumnName = proc.name.substr(table.name.length + 1);
        function makeField(forceList) {
          const fieldName = forceList
            ? inflection.computedColumnList(pseudoColumnName, proc, table)
            : inflection.computedColumn(pseudoColumnName, proc, table);
          try {
            memo = extend(
              memo,
              {
                [fieldName]: makeProcField(fieldName, proc, build, {
                  fieldWithHooks,
                  computed: true,
                  forceList,
                }),
              },
              `Adding computed column for ${describePgEntity(
                proc
              )}. You can rename this field with:\n\n  ${sqlCommentByAddingTags(
                proc,
                {
                  fieldName: "newNameHere",
                }
              )}`
            );
          } catch (e) {
            swallowError(e);
          }
        }
        if (!proc.returnsSet || hasConnections) {
          makeField(false);
        }
        if (proc.returnsSet && hasSimpleCollections) {
          makeField(true);
        }
        return memo;
      }, {}),
      `Adding computed column to '${Self.name}'`
    );
  });
}: Plugin);
