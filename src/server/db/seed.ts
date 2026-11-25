import type { DbClient } from './client.js';

/**
 * 生产环境不再注入任何内置演示账号或测试数据；
 * 系统首次启动后，第一个注册的用户会自动成为系统管理员（admin）。
 */
export async function seedDemoDatabase(_db: DbClient): Promise<void> {
  // no-op
}
