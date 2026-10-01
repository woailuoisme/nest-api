/** 用户输入的原始字段定义 */
export interface FieldDef {
  name: string;
  type: FieldType;
  description?: string;
  required?: boolean;
}

/** 模块作用域：后台管理面 (admin) | 客户端业务面 (client) */
export type ModuleScope = 'admin' | 'client';

/** 支持的字段类型 */
export type FieldType = 'string' | 'email' | 'number' | 'float' | 'boolean' | 'text' | 'date';

/** nest-commander 解析后的命令选项 */
export interface CommandOptions {
  name: string;
  scope?: ModuleScope;
  fromSchema?: string;
  fromEntity?: string;
  force?: boolean;
  delete?: boolean;
}

/** 传递给 Handlebars 模板的单个字段上下文 */
export interface TemplateField {
  name: string;
  type: string;
  description: string;
  dbColumnName: string;
  drizzleType: string;
  tsType: string;
  isOptional: boolean;
  apiProperty: string;
  responseApiProperty: string;
  zodValidation: string;
  zodFilterValidation: string;
  /** 响应资源 schema 校验器（输出类型，无输入约束） */
  zodResponseValidation: string;
  mockValue: string;
  createMockValue: string;
}

/** 传递给 Handlebars 模板的完整上下文 */
export interface TemplateContext {
  featureName: string;
  FeatureName: string;
  description: string;
  tableName: string;
  tableVariable: string;
  scope: ModuleScope;
  routePrefix: string;
  featureModulePath: string;
  pageSize: number;
  hasVarchar: boolean;
  hasText: boolean;
  hasInteger: boolean;
  hasReal: boolean;
  hasBoolean: boolean;
  hasTimestamp: boolean;
  hasEmail: boolean;
  hasRelations: boolean;
  hasUniqueFields: boolean;
  fields: TemplateField[];
  createFields: TemplateField[];
  updateFields: TemplateField[];
  filterFields: TemplateField[];
  searchFields: TemplateField[];
  uniqueFields: TemplateField[];
}
