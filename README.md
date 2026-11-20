# 视频反推提示词 · 手机 APP

给一条视频，反推出能复刻它的 AI 视频生成提示词。**不生成视频，只出提示词。**

## 原理

手机本地抽关键帧 → 直接调阿里云百炼视觉模型 → 模型看帧反推提示词 → 显示在 APP 里可复制/保存。

- 视频本身不上传，只传几张 JPEG 帧图，省流量
- 没服务器、没月费，Key 用你自己的百炼账号
- API Key 只存手机本地，不进代码、不上传

## 获取 API Key

1. 打开 [阿里云百炼控制台](https://bailian.console.aliyun.com/)
2. 开通服务 → 右上角头像 → API-Key 管理 → 创建 Key
3. 复制 Key，在 APP 右上角 ⚙ 里填入（百炼新用户有免费额度）

## 安装

在 GitHub Releases 页面下载最新 `.apk`，传到手机安装。
Android 会提示"未知来源"，允许即可（自己编译的 APK 都这样）。

## 自己编译 / 改代码

```bash
npm install
npm run android        # 同步代码到 Android 工程
cd android && ./gradlew assembleDebug   # 需要 JDK 21 + Android SDK
```

或者推一个 `v` 开头的 tag（比如 `v1.0.1`），GitHub Actions 会自动编译 APK 并发到 Releases。

## 更新

APP 启动时自动检查 GitHub Releases。设置里也能手动点"检查更新"。
