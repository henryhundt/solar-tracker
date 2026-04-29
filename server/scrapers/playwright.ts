import { chromium, type Browser } from "playwright";

const CHROMIUM_LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
];

export async function launchScraperChromium(): Promise<Browser> {
  try {
    return await chromium.launch({
      headless: true,
      args: CHROMIUM_LAUNCH_ARGS,
    });
  } catch (error) {
    throw normalizePlaywrightLaunchError(error);
  }
}

function normalizePlaywrightLaunchError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (
    /Executable doesn't exist|Please run .*playwright install|browserType\.launch: Executable/i.test(message)
  ) {
    return new Error(
      "Playwright Chromium is not installed. Run `npx playwright install chromium` and try again."
    );
  }

  if (
    /mach_port_rendezvous_mac|bootstrap_check_in .* Permission denied|Target page, context or browser has been closed/i.test(
      message
    )
  ) {
    return new Error(
      "Playwright Chromium could not launch in the current sandboxed environment. Retry from the normal app runtime or outside the sandbox."
    );
  }

  return error instanceof Error ? error : new Error(message);
}
