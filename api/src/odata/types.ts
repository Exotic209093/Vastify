// OData 4.0 $filter AST + $orderby + paging representation.
// Intentionally small: covers what Salesforce Connect actually sends for list views.

export type ComparisonOp = 'eq' | 'ne' | 'gt' | 'lt' | 'ge' | 'le';

export type FilterLiteral =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'null' }
  | { kind: 'datetime'; value: number }; // stored as epoch ms

export type FilterExpr =
  | { kind: 'and'; left: FilterExpr; right: FilterExpr }
  | { kind: 'or'; left: FilterExpr; right: FilterExpr }
  | { kind: 'not'; expr: FilterExpr }
  | { kind: 'cmp'; op: ComparisonOp; field: string; value: FilterLiteral }
  | { kind: 'paren'; expr: FilterExpr };

export interface ODataOrderBy {
  field: string;
  direction: 'asc' | 'desc';
}

export interface ODataQuery {
  filter?: FilterExpr;
  orderBy?: ODataOrderBy[];
  top?: number;
  skip?: number;
  select?: string[];
  count?: boolean;
}
