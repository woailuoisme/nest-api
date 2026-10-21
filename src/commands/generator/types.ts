/** Raw field definitions as provided by the user */
export interface FieldDef {
  name: string;
  type: FieldType;
  description?: string;
  required?: boolean;
}

/** Module scope: back-office (admin) | client-facing (client) */
export type ModuleScope = 'admin' | 'client';

/** Supported field types */
export type FieldType = 'string' | 'email' | 'number' | 'float' | 'boolean' | 'text' | 'date';

/** Command options parsed by nest-commander */
export interface CommandOptions {
  name: string;
  scope?: ModuleScope;
  fromSchema?: string;
  fromEntity?: string;
  force?: boolean;
  delete?: boolean;
}

/** Single field context passed to the Handlebars templates */
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
  /** Response resource schema validator (output type, no input constraints) */
  zodResponseValidation: string;
  mockValue: string;
  createMockValue: string;
}

/** Full context passed to the Handlebars templates */
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
