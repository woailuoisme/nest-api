import type {
  FromCollection,
  WithColumnWidths,
  WithHeadings,
  WithMapping,
  WithTitle,
} from '@/common/excel/interfaces/excel-export.interface';

/** 导出的用户行数据类型 */
interface ExportUserRow {
  id: number;
  email: string;
  role: string;
  createdAt: Date;
}

export class UsersExport
  implements FromCollection<ExportUserRow>, WithHeadings, WithMapping<ExportUserRow>, WithColumnWidths, WithTitle
{
  constructor(private readonly users: ExportUserRow[]) {}

  collection(): ExportUserRow[] {
    return this.users;
  }

  title(): string {
    return '用户列表';
  }

  headings(): string[] {
    return ['ID', '邮箱', '角色', '创建时间'];
  }

  map(user: ExportUserRow): (string | number | Date)[] {
    return [user.id, user.email, user.role, user.createdAt];
  }

  columnWidths(): number[] {
    return [30, 25, 15, 25];
  }
}
