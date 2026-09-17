import { desktopCapturer, screen } from "electron";
import { mouse, keyboard, Point, Button, Key } from "@nut-tree-fork/nut-js";

export interface ScreenshotResult {
  base64Png: string;
  width: number;
  height: number;
}

export async function captureScreenshot(): Promise<ScreenshotResult> {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;

  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width, height },
  });
  const source = sources[0];
  if (!source) throw new Error("no-screen-source");

  return {
    base64Png: source.thumbnail.toPNG().toString("base64"),
    width,
    height,
  };
}

export type ComputerAction =
  | { type: "click"; x: number; y: number; button?: "left" | "right" }
  | { type: "double_click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; amount: number }
  | { type: "wait"; ms: number };

const KEY_MAP: Record<string, Key> = {
  enter: Key.Enter,
  tab: Key.Tab,
  escape: Key.Escape,
  backspace: Key.Backspace,
  delete: Key.Delete,
  up: Key.Up,
  down: Key.Down,
  left: Key.Left,
  right: Key.Right,
  space: Key.Space,
};

export async function executeAction(action: ComputerAction): Promise<void> {
  switch (action.type) {
    case "click":
      await mouse.setPosition(new Point(action.x, action.y));
      await mouse.click(action.button === "right" ? Button.RIGHT : Button.LEFT);
      return;

    case "double_click":
      await mouse.setPosition(new Point(action.x, action.y));
      await mouse.doubleClick(Button.LEFT);
      return;

    case "type":
      await keyboard.type(action.text);
      return;

    case "key": {
      const key = KEY_MAP[action.key.toLowerCase()];
      if (!key) throw new Error(`unknown-key:${action.key}`);
      await keyboard.pressKey(key);
      await keyboard.releaseKey(key);
      return;
    }

    case "scroll":
      if (action.amount > 0) await mouse.scrollDown(action.amount);
      else await mouse.scrollUp(-action.amount);
      return;

    case "wait":
      await new Promise((resolve) => setTimeout(resolve, action.ms));
      return;
  }
}
