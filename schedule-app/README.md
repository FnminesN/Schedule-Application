# 我的日程（网页版）

一个零依赖、纯前端运行的日程安排应用：打开页面即可使用。支持 PWA（可安装到手机/电脑桌面、离线打开），并可选接入 Supabase 免费云存储，实现跨设备云同步。

## 二级菜单导航

应用采用“月 → 日”的两级菜单结构，并带滑动切换动画：

- **第一级（月菜单）**：打开应用默认进入当月天数菜单，一天一格，可直接切换上/下个月；每格显示星期，并标注当天有几项日程，今天高亮。
- **第二级（当日日程）**：点击某一天，即滑入当天的日程时间轴，可查看、点击新建、编辑或复制当天日程；支持前一天/后一天快速切换。右侧的「当日日程」信息栏会列出这一天的每项日程，显示日程名称、时间、分类和备注（没有备注时显示“无备注”），点击条目可直接编辑。
- **左上角返回**：第二级界面左上角有“← 返回”按钮，点击后当前页面滑出、月菜单滑回，并保留所选日期的选中高亮；返回按钮的箭头在悬停时也有小动画。
- **周视图**：保留原来的整周视图，右上角“周视图”按钮随时可进入，同样支持返回。

## 如何打开

**最简单**：用 Chrome / Edge 直接双击打开 `index.html` 即可。

也可以用本地服务方式打开（更接近正式部署，推荐）：

```bash
# 方式一：Node（已安装时）
npx serve .

# 方式二：Python
python -m http.server 8000
```

然后访问 `http://localhost:8000`。

正式线上地址（GitHub Pages）：`https://FnminesN.github.io/Schedule-Application/`

## 手机端（PWA）

用手机浏览器（Chrome / Edge / Safari）打开线上地址后：

- **Android / Chrome**：菜单里选择「添加到主屏幕」或「安装应用」。
- **iPhone / Safari**：点分享按钮 → 「添加到主屏幕」。

添加后应用会像普通 App 一样有独立图标，并且**离线也能打开**（查看已加载过的界面）。

## 功能

- **周视图**：一次查看一整周（周一到周日），可前后翻周、一键回到本周，今天高亮。
- **日程增删改**：点击空白时间格快速新建；点击日程块即可编辑或删除；支持全天日程。
- **分类**：内置工作/个人/学习/健康/其他，可自由添加、重命名、改颜色、删除；点击分类标签可筛选。
- **复制日程**：点某一天右上角的 ⧉ 可把该天日程复制到其他日期（可勾选要复制的条目）；编辑日程时也可单条复制到其他日期。
- **导入**：支持 JSON 备份、CSV 表格、ICS 日历（如 Google/Outlook 导出的 .ics）三种格式。
- **导出**：JSON 完整备份（可再导入恢复）、CSV 表格。
- **通知提醒**：每个日程可设置提醒（准时/提前 5 分钟到 1 天），到达提醒时间后页面内弹提示，并可选发送系统通知。

## 导入格式说明

### CSV

表头需包含「日期」和「标题」列，其他列可选，顺序不限：

```csv
日期,开始,结束,标题,分类,备注,提醒(分钟)
2026-08-27,09:00,10:00,团队周会,工作,准备周报,10
2026-08-28,14:30,15:30,产品评审,工作,,15
```

日期支持 `2026-08-27`、`2026/08/27` 等常见写法；开始/结束为空表示全天。

### ICS

支持常规 `VEVENT`（含全天与带时间日程）。循环日程（RRULE）会按首次出现导入一条，需要重复时可手动复制。

### JSON

由本应用的「导出 JSON 备份」生成的文件可直接导入恢复。

## 数据与提醒须知

- 未配置云同步时，数据保存在**当前浏览器的本地存储**中，更换浏览器或清除站点数据会丢失，重要数据请定期「导出 JSON 备份」。
- 系统通知需要浏览器授权，且**页面保持打开**时才会触发；页面内提示不受影响。
- 右上角「🔔 提醒」可开关系统通知并发送测试通知。
- 目前为单人使用，暂不支持多人共享（按你的需求未实现）。

## 云同步（Supabase）

应用右上角新增「☁️ 同步」入口，接入 [Supabase](https://supabase.com) 免费项目后，日程会跟随账号在手机和电脑之间同步。免费额度足够个人日常使用。

### 第一次配置（约 5 分钟）

1. 打开 [supabase.com](https://supabase.com) 注册/登录，点击 **New project** 创建一个项目（区域任选，如 Asia 或新加坡）。
2. 项目创建完成后，进入 **SQL Editor**，新建查询并运行下面这段 SQL，创建 `events` 表和安全策略：

```sql
create table if not exists public.events (
  id text primary key,
  user_id uuid not null default auth.uid(),
  title text not null,
  date text not null,
  start_time text,
  end_time text,
  category text,
  notes text default '',
  remind_minutes int,
  created_at bigint,
  updated_at bigint,
  deleted boolean default false
);

alter table public.events enable row level security;

create policy "own_select" on public.events
  for select using (auth.uid() = user_id);
create policy "own_insert" on public.events
  for insert with check (auth.uid() = user_id);
create policy "own_update" on public.events
  for update using (auth.uid() = user_id);
create policy "own_delete" on public.events
  for delete using (auth.uid() = user_id);
```

3. 进入 **Project Settings → API**，复制 **Project URL** 和 **anon public key**。
4. 打开应用 → 右上角「☁️ 同步」→ 粘贴项目地址和密钥 → 保存配置。
5. 输入邮箱和密码，点「注册并登录」（如果开启了邮箱确认，先去邮箱点确认链接，再回来登录）。

### 使用说明

- 登录后，日程的**增删改会自动同步**到云端（修改后约 2 秒自动上传）。
- 「立即同步」：手动拉取云端并合并（同一日程以最后修改的时间为准）。
- 「从云端恢复」：用云端数据**覆盖**本地，适合换新设备时使用。
- 退出登录后应用恢复纯本地模式，数据仍留在浏览器里。
