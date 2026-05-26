import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerDMG } from '@electron-forge/maker-dmg';
import MakerAppImage from '@reforged/maker-appimage';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { notarize } from '@electron/notarize';
import { execFileSync } from 'node:child_process';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'NodeGrip',
    // Linux makers (MakerDeb in particular) expect the binary inside the
    // packaged folder to match the lowercased project `name` field. Force
    // it here so .deb / .rpm find the executable.
    executableName: 'node-grip',
    // forge resolves per-platform extensions: icon.ico / icon.icns / icon.png
    icon: './icon',
    // Resources we need at runtime: only the app icon (used as the
    // BrowserWindow icon hint on Win/Linux). NodeGrip doesn't own any
    // OS file type, so no per-document icon is bundled.
    extraResource: ['./icon.png'],
    // macOS code signing with a Developer ID Application certificate.
    // Falls back to ad-hoc signing when APPLE_SIGNING_IDENTITY is unset
    // (e.g. forks/CI without secrets) so the build doesn't fail outright.
    osxSign: {
      identity:
        process.env.APPLE_SIGNING_IDENTITY ||
        'Developer ID Application: HONTRACK S. DE R.L. (A384K33T3Y)',
      optionsForFile: () => ({
        hardenedRuntime: true,
        entitlements: './build/entitlements.mac.plist',
        'entitlements-inherit': './build/entitlements.mac.plist',
      }),
    },
    // Notarize the signed .app with Apple. Only runs when the three env
    // vars are present — otherwise forge silently skips notarization,
    // which keeps local "just build something" workflows usable.
    osxNotarize:
      process.env.APPLE_ID && process.env.APPLE_ID_PASSWORD && process.env.APPLE_TEAM_ID
        ? {
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_ID_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID,
          }
        : undefined,
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      // We renamed the executable to lowercase via executableName above, so
      // Squirrel needs to be told which .exe to wrap (defaults to <name>.exe
      // based on packagerConfig.name = "NodeGrip" and would not match).
      exe: 'node-grip.exe',
      setupIcon: './icon.ico',
      // Control Panel > Programs and Features and the "Apps & Features"
      // settings pane read DisplayIcon from the NuGet manifest. Without
      // iconUrl Squirrel defaults to electron.ico from the Electron repo,
      // which shows up as the generic Atom-style icon for our install
      // entry. Point it at our raw icon.ico in the repo (Windows caches it
      // locally on first install).
      iconUrl: 'https://raw.githubusercontent.com/remdph/node-grip/main/icon.ico',
    }),
    // Keep the .zip alongside the .dmg for users who want a portable bundle.
    new MakerZIP({}, ['darwin']),
    // Custom DMG layout: dark-header background + curved drag arrow, the
    // .app on the left and an Applications alias on the right. Positions
    // line up with the artwork in build/dmg-background.svg.
    new MakerDMG(
      {
        background: './build/dmg-background.png',
        format: 'ULFO',
        additionalDMGOptions: {
          window: {
            size: { width: 600, height: 400 },
          },
        },
        contents: (opts: { appPath: string }) => [
          { x: 150, y: 240, type: 'file', path: opts.appPath },
          { x: 450, y: 240, type: 'link', path: '/Applications' },
        ],
      },
      ['darwin'],
    ),
    // Linux installers. NodeGrip is a Development tool — no MIME types
    // are registered because the app doesn't own any file format.
    // electron-installer-{debian,redhat} only embed an icon in the
    // .desktop file + /usr/share/pixmaps if we pass `icon` explicitly.
    // `packagerConfig.icon` is ignored on Linux because Linux binaries
    // don't carry an icon resource.
    new MakerRpm({
      options: {
        icon: './icon.png',
        categories: ['Development'],
      },
    }),
    new MakerDeb({
      options: {
        icon: './icon.png',
        categories: ['Development'],
      },
    }),
    // Distro-agnostic single-file binary for users on Arch / NixOS / any
    // exotic Linux. Users chmod +x and double-click; no install step.
    new MakerAppImage(
      {
        options: {
          icon: './icon.png',
          categories: ['Development'],
        },
      },
      ['linux'],
    ),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  hooks: {
    // electron-forge signs and notarizes the .app inside packagerConfig,
    // but the .dmg produced by MakerDMG is left unsigned. Sign + notarize +
    // staple the DMG itself so Gatekeeper accepts the downloaded volume
    // (`spctl --assess --type install` → "Notarized Developer ID").
    postMake: async (_forgeConfig, makeResults) => {
      if (process.platform !== 'darwin') return makeResults;

      const identity =
        process.env.APPLE_SIGNING_IDENTITY ||
        'Developer ID Application: HONTRACK S. DE R.L. (A384K33T3Y)';
      const { APPLE_ID, APPLE_ID_PASSWORD, APPLE_TEAM_ID } = process.env;
      const canNotarize = Boolean(APPLE_ID && APPLE_ID_PASSWORD && APPLE_TEAM_ID);

      for (const result of makeResults) {
        for (const artifact of result.artifacts) {
          if (!artifact.endsWith('.dmg')) continue;
          console.log(`[postMake] signing ${artifact}`);
          execFileSync(
            'codesign',
            ['--sign', identity, '--timestamp', '--force', artifact],
            { stdio: 'inherit' },
          );
          if (!canNotarize) {
            console.log('[postMake] notarize env vars missing, skipping notarization');
            continue;
          }
          console.log(`[postMake] notarizing ${artifact} (Apple round-trip)`);
          await notarize({
            appPath: artifact,
            appleId: APPLE_ID!,
            appleIdPassword: APPLE_ID_PASSWORD!,
            teamId: APPLE_TEAM_ID!,
          });
          console.log(`[postMake] stapling ${artifact}`);
          execFileSync('xcrun', ['stapler', 'staple', artifact], { stdio: 'inherit' });
        }
      }
      return makeResults;
    },
  },
};

export default config;
