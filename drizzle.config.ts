// 只描述数据库 schema 与迁移产物位置；读取本配置不会执行迁移。
// Describe schema and migration output locations; reading this configuration does not apply migrations.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  // 可维护的表定义；列名与现有 D1 数据兼容，不因可读性重构改名。
  // Maintained table declarations; preserve column names for existing D1 data.
  schema: './db/schema.ts',
  // 已生成/已应用迁移不手工美化；新迁移必须单独审查。
  // Never hand-reformat generated/applied migrations; review new migrations separately.
  out: './drizzle',
  dialect: 'sqlite',
});
