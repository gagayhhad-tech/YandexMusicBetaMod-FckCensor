import axios from "axios";
import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { ok, err, Result } from "neverthrow";

import type { AppBuild } from "~/types/AppBuild";

const UPDATE_DOMAIN = "https://music-desktop-application.s3.yandex.net";

// Zod schema that describes the shape of the update YAML we expect from the server.
const UpdateInfoSchema = z.object({
  files: z.array(
    z.object({
      url: z.string(),
      sha512: z.string(),
      size: z.number(),
    })
  ),
  releaseDate: z.string().optional(),
  updateProbability: z.number().optional(),
  version: z.string(),
  commonConfig: z.object({
    DEPRECATED_VERSIONS: z.string().optional(),
  }),
});

/**
 * Fetches latest stable build information.
 *
 * Returns a neverthrow Result that is Ok(files[]) when the remote
 * YAML validates against the UpdateInfoSchema, or Err(error) when
 * validation fails or the HTTP/YAML step throws.
 */
export async function getStableBuild(): Promise<Result<AppBuild[], Error>> {
  try {
    const localBuildPath = process.env.YANDEX_MUSIC_BUILD_PATH;
    if (localBuildPath) {
      const resolvedBuildPath = path.resolve(localBuildPath);
      const version =
        process.env.YANDEX_MUSIC_BUILD_VERSION ?? path.basename(resolvedBuildPath).match(/(\d+\.\d+\.\d+)/)?.[1];

      if (!version) {
        return err(new Error("Cannot determine local Yandex Music build version"));
      }

      const stat = await fs.promises.stat(resolvedBuildPath);
      return ok([
        {
          path: resolvedBuildPath,
          hash: "",
          size: stat.size,
          releaseDate: "",
          updateProbability: 100,
          version,
          deprecatedVersions: "",
        },
      ]);
    }

    const response = await fetch(`${UPDATE_DOMAIN}/stable/latest.yml`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch latest.yml: ${response.statusText}`);
    }
    const rawData = await response.text();
    const rawInfo = yaml.load(rawData);

    // Validate and narrow the data using zod.
    const parseResult = UpdateInfoSchema.safeParse(rawInfo);
    if (!parseResult.success) {
      // Return zod errors wrapped in neverthrow Err.
      return err(parseResult.error);
    }

    const info = parseResult.data;

    const files = info.files.map((file) => ({
      path: file.url,
      hash: file.sha512,
      size: file.size,
      releaseDate: info.releaseDate,
      updateProbability: info.updateProbability,
      version: info.version,
      deprecatedVersions: info.commonConfig.DEPRECATED_VERSIONS,
    })) as AppBuild[];

    return ok(files);
  } catch (error) {
    return err(error as Error);
  }
}

/**
 * Downloads a build from the update server.
 *
 * Returns a neverthrow Result that is Ok(file) when the build is downloaded, or Err(error) when the download fails.
 */
export async function downloadBuild(
  build: AppBuild,
  filePath: string
): Promise<Result<void, Error>> {
  try {
    if (path.isAbsolute(build.path)) {
      await fs.promises.copyFile(build.path, filePath);
      return ok();
    }

    const response = await fetch(`${UPDATE_DOMAIN}/stable/${build.path}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(`Download failed with status: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    await Bun.write(filePath, arrayBuffer);

    return ok();
  } catch (error) {
    return err(error as Error);
  }
}
