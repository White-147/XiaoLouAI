// scripts/notarize.js
import { notarize } from "@electron/notarize";

export default async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;
  const appPath = `${appOutDir}/Jaaz.app`;
  console.log("appPath", appPath);
  return await notarize({
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_PASSWORD,
    teamId: process.env.TEAM_ID,
  });
}
