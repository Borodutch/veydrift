import { describe, expect, test } from "bun:test";
import {
  createPlanetPickerInteractionController,
  installPlanetPickerTouchMoveGuard,
  PLANET_PICKER_LONG_PRESS_MS,
  planetPickerDropPosition,
  readPlanetPickerOrder,
  writePlanetPickerOrder,
} from "../src/planetPickerOrder";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function timedController() {
  let currentTime = 0;
  return {
    controller: createPlanetPickerInteractionController({ now: () => currentTime }),
    setTime(value: number) {
      currentTime = value;
    },
  };
}

describe("planet picker long-press interaction controller", () => {
  test("installs the touch guard before activation and only cancels moves while active", () => {
    const target = new EventTarget();
    const guard = installPlanetPickerTouchMoveGuard(target);

    const pendingMove = new Event("touchmove", { cancelable: true });
    expect(target.dispatchEvent(pendingMove)).toBe(true);
    expect(pendingMove.defaultPrevented).toBe(false);

    guard.setActive(true);
    const activeMove = new Event("touchmove", { cancelable: true });
    expect(target.dispatchEvent(activeMove)).toBe(false);
    expect(activeMove.defaultPrevented).toBe(true);

    guard.dispose();
    const moveAfterDispose = new Event("touchmove", { cancelable: true });
    expect(target.dispatchEvent(moveAfterDispose)).toBe(true);
    expect(moveAfterDispose.defaultPrevented).toBe(false);
  });

  test("requires the full deliberate delay before activating reorder mode", () => {
    const interaction = timedController();
    expect(interaction.controller.beginPointer({
      button: 0,
      clientX: 20,
      clientY: 20,
      orderIds: ["1", "2", "3"],
      planetId: "1",
      pointerId: 7,
      pointerType: "mouse",
    })).toBe(true);

    interaction.setTime(PLANET_PICKER_LONG_PRESS_MS - 1);
    expect(interaction.controller.activatePointer(7)).toEqual({ activated: false });
    expect(interaction.controller.movePointer({
      clientX: 23,
      clientY: 24,
      pointerId: 7,
      pointerType: "mouse",
    })).toEqual({ status: "pending", planetId: "1" });

    interaction.setTime(PLANET_PICKER_LONG_PRESS_MS);
    expect(interaction.controller.activatePointer(7)).toEqual({ activated: true, planetId: "1" });
    expect(interaction.controller.movePointer({
      clientX: 24,
      clientY: 24,
      pointerId: 7,
      pointerType: "mouse",
    })).toEqual({ status: "dragging", dragStarted: true, planetId: "1" });
  });

  test("finishes a short tap without starting reorder so normal selection can continue", () => {
    const interaction = timedController();
    interaction.controller.beginPointer({
      button: 0,
      clientX: 20,
      clientY: 20,
      orderIds: ["1", "2", "3"],
      planetId: "2",
      pointerId: 8,
      pointerType: "touch",
    });
    interaction.setTime(120);

    expect(interaction.controller.finishPointer(8)).toEqual({
      finished: true,
      planetId: "2",
      wasDragging: false,
    });
    expect(interaction.controller.activatePointer(8)).toEqual({ activated: false });
    expect(interaction.controller.reorderPointerTarget("3", "after")).toBeUndefined();
  });

  test("cancels long press when movement exceeds tolerance before activation", () => {
    const interaction = timedController();
    interaction.controller.beginPointer({
      button: 0,
      clientX: 10,
      clientY: 10,
      orderIds: ["1", "2", "3"],
      planetId: "1",
      pointerId: 9,
      pointerType: "touch",
    });

    expect(interaction.controller.movePointer({
      clientX: 17,
      clientY: 10,
      pointerId: 9,
      pointerType: "touch",
    })).toEqual({ status: "cancelled", planetId: "1" });
    interaction.setTime(PLANET_PICKER_LONG_PRESS_MS + 100);
    expect(interaction.controller.activatePointer(9)).toEqual({ activated: false });
    expect(interaction.controller.reorderPointerTarget("3", "after")).toBeUndefined();
    expect(interaction.controller.finishPointer(9)).toEqual({ finished: false, wasDragging: false });
  });

  test("keeps mobile scrolling safe in either axis before the long-press threshold", () => {
    for (const [pointerId, clientX, clientY] of [
      [10, 18, 10],
      [11, 10, 18],
    ]) {
      const interaction = timedController();
      interaction.controller.beginPointer({
        button: 0,
        clientX: 10,
        clientY: 10,
        orderIds: ["1", "2"],
        planetId: "1",
        pointerId,
        pointerType: "touch",
      });
      expect(interaction.controller.movePointer({
        clientX,
        clientY,
        pointerId,
        pointerType: "touch",
      })).toEqual({ status: "cancelled", planetId: "1" });
    }
  });

  test("reorders the parent planet group after touch long press and persists per wallet", () => {
    const interaction = timedController();
    const storage = memoryStorage();
    interaction.controller.beginPointer({
      button: 0,
      clientX: 12,
      clientY: 12,
      orderIds: ["1", "2", "3"],
      planetId: "3",
      pointerId: 12,
      pointerType: "touch",
    });
    interaction.setTime(PLANET_PICKER_LONG_PRESS_MS);
    expect(interaction.controller.activatePointer(12)).toEqual({ activated: true, planetId: "3" });

    expect(interaction.controller.movePointer({
      clientX: 2,
      clientY: 12,
      pointerId: 12,
      pointerType: "touch",
    })).toEqual({ status: "dragging", dragStarted: true, planetId: "3" });
    const position = planetPickerDropPosition(
      "mobile",
      101,
      900,
      { height: 80, left: 100, top: 20, width: 100 },
    );
    const reordered = interaction.controller.reorderPointerTarget("1", position);
    expect(position).toBe("before");
    expect(reordered?.nextPlanetIds).toEqual(["3", "1", "2"]);

    writePlanetPickerOrder(storage, "0xAAA", reordered?.nextPlanetIds ?? []);
    expect(readPlanetPickerOrder(storage, "0xaaa")).toEqual(["3", "1", "2"]);
    expect(readPlanetPickerOrder(storage, "0xbbb")).toBeUndefined();
    expect(interaction.controller.finishPointer(12)).toEqual({
      finished: true,
      planetId: "3",
      wasDragging: true,
    });
  });

  test("pointer release, cancel, capture loss, and Escape-style cancellation clear active state", () => {
    for (const [pointerId, finish] of [
      [21, "finish"],
      [22, "cancel"],
    ] as const) {
      const interaction = timedController();
      interaction.controller.beginPointer({
        button: 0,
        clientX: 0,
        clientY: 0,
        orderIds: ["1", "2"],
        planetId: "1",
        pointerId,
        pointerType: "touch",
      });
      interaction.setTime(PLANET_PICKER_LONG_PRESS_MS);
      interaction.controller.activatePointer(pointerId);

      expect(interaction.controller.finishPointer(pointerId + 100)).toEqual({
        finished: false,
        wasDragging: false,
      });
      const result = finish === "finish"
        ? interaction.controller.finishPointer(pointerId)
        : interaction.controller.cancelPointer(pointerId);
      expect(result).toEqual({ finished: true, planetId: "1", wasDragging: true });
      expect(interaction.controller.reorderPointerTarget("2", "after")).toBeUndefined();
      expect(interaction.controller.movePointer({
        clientX: 20,
        clientY: 0,
        pointerId,
        pointerType: "touch",
      })).toEqual({ status: "ignored" });
    }
  });

  test("Arrow, Home, and End keyboard commands move the group and can persist", () => {
    const controller = createPlanetPickerInteractionController();
    const storage = memoryStorage();

    const arrow = controller.reorderFromKey(["1", "2", "3"], "2", "ArrowLeft");
    expect(arrow).toEqual({ handled: true, nextPlanetIds: ["2", "1", "3"] });
    const end = controller.reorderFromKey(arrow.nextPlanetIds, "2", "End");
    expect(end).toEqual({ handled: true, nextPlanetIds: ["1", "3", "2"] });
    const home = controller.reorderFromKey(end.nextPlanetIds, "2", "Home");
    expect(home).toEqual({ handled: true, nextPlanetIds: ["2", "1", "3"] });
    expect(controller.reorderFromKey(home.nextPlanetIds, "2", "Enter")).toEqual({
      handled: false,
      nextPlanetIds: ["2", "1", "3"],
    });

    writePlanetPickerOrder(storage, "0xABC", home.nextPlanetIds);
    expect(readPlanetPickerOrder(storage, "0xabc")).toEqual(["2", "1", "3"]);
  });

  test("uses horizontal mobile and vertical sidebar target halves", () => {
    const bounds = { height: 80, left: 100, top: 200, width: 120 };
    expect(planetPickerDropPosition("mobile", 120, 999, bounds)).toBe("before");
    expect(planetPickerDropPosition("mobile", 200, 0, bounds)).toBe("after");
    expect(planetPickerDropPosition("sidebar", 0, 210, bounds)).toBe("before");
    expect(planetPickerDropPosition("sidebar", 999, 270, bounds)).toBe("after");
  });
});
