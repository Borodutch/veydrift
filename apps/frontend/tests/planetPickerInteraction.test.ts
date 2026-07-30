import { describe, expect, test } from "bun:test";
import { PlanetPickerReorderHandle } from "../src/PlayableMvpApp";
import {
  createPlanetPickerInteractionController,
  planetPickerDropPosition,
  readPlanetPickerOrder,
  writePlanetPickerOrder,
} from "../src/planetPickerOrder";

type InvokableHandleProps = {
  onClick: (event: InteractionEvent) => void;
  onKeyDown: (event: InteractionEvent) => void;
  onPointerCancel: (event: InteractionEvent) => void;
  onPointerDown: (event: InteractionEvent) => void;
  onPointerMove: (event: InteractionEvent) => void;
  onPointerUp: (event: InteractionEvent) => void;
};

type InteractionEvent = {
  preventDefault(): void;
  stopPropagation(): void;
};

function interactionEvent() {
  let defaultPrevented = false;
  let propagationStopped = false;
  return {
    event: {
      preventDefault() {
        defaultPrevented = true;
      },
      stopPropagation() {
        propagationStopped = true;
      },
    },
    get defaultPrevented() {
      return defaultPrevented;
    },
    get propagationStopped() {
      return propagationStopped;
    },
  };
}

function handleProps(callbacks: Partial<Record<keyof InvokableHandleProps, () => void>> = {}) {
  const vnode = PlanetPickerReorderHandle({
    dragging: false,
    label: "New Zion",
    onKeyDown: () => callbacks.onKeyDown?.(),
    onPointerCancel: () => callbacks.onPointerCancel?.(),
    onPointerDown: () => callbacks.onPointerDown?.(),
    onPointerMove: () => callbacks.onPointerMove?.(),
    onPointerUp: () => callbacks.onPointerUp?.(),
    planetId: "1",
  }) as unknown as { props: InvokableHandleProps };
  return vnode.props;
}

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

describe("planet picker interaction controller", () => {
  test("isolates handle tap/click from planet selection and the mobile picker container", () => {
    let pointerDownCalls = 0;
    let planetSelections = 0;
    let mobilePickerCloses = 0;
    const props = handleProps({
      onPointerDown: () => {
        pointerDownCalls += 1;
      },
    });

    const pointerDown = interactionEvent();
    props.onPointerDown(pointerDown.event);
    if (!pointerDown.propagationStopped) mobilePickerCloses += 1;

    const click = interactionEvent();
    props.onClick(click.event);
    if (!click.propagationStopped) {
      planetSelections += 1;
      mobilePickerCloses += 1;
    }

    expect(pointerDownCalls).toBe(1);
    expect(pointerDown.propagationStopped).toBe(true);
    expect(click.propagationStopped).toBe(true);
    expect(click.defaultPrevented).toBe(true);
    expect(planetSelections).toBe(0);
    expect(mobilePickerCloses).toBe(0);
  });

  test("keeps a below-threshold pointer gesture as a no-op and cleans it up on pointer up", () => {
    const controller = createPlanetPickerInteractionController();
    expect(controller.beginPointer({
      button: 0,
      clientX: 20,
      clientY: 20,
      orderIds: ["1", "2", "3"],
      planetId: "1",
      pointerId: 7,
      pointerType: "mouse",
    })).toBe(true);

    expect(controller.movePointer({
      clientX: 23,
      clientY: 24,
      pointerId: 7,
      pointerType: "mouse",
    })).toEqual({ status: "pending", planetId: "1" });
    expect(controller.reorderPointerTarget("3", "after")).toBeUndefined();
    expect(controller.finishPointer(7)).toEqual({ finished: true, wasDragging: false });
    expect(controller.movePointer({
      clientX: 40,
      clientY: 40,
      pointerId: 7,
      pointerType: "mouse",
    })).toEqual({ status: "ignored" });
  });

  test("forwards pointer move, up, and cancel without bubbling out of the handle", () => {
    const calls = { cancel: 0, move: 0, up: 0 };
    const props = handleProps({
      onPointerCancel: () => {
        calls.cancel += 1;
      },
      onPointerMove: () => {
        calls.move += 1;
      },
      onPointerUp: () => {
        calls.up += 1;
      },
    });

    for (const [handler, key] of [
      [props.onPointerMove, "move"],
      [props.onPointerUp, "up"],
      [props.onPointerCancel, "cancel"],
    ] as const) {
      const interaction = interactionEvent();
      handler(interaction.event);
      expect(interaction.propagationStopped).toBe(true);
      expect(calls[key]).toBe(1);
    }
  });

  test("reorders after deliberate mouse movement", () => {
    const controller = createPlanetPickerInteractionController();
    controller.beginPointer({
      button: 0,
      clientX: 10,
      clientY: 10,
      orderIds: ["1", "2", "3"],
      planetId: "1",
      pointerId: 8,
      pointerType: "mouse",
    });

    expect(controller.movePointer({
      clientX: 17,
      clientY: 10,
      pointerId: 8,
      pointerType: "mouse",
    })).toEqual({ status: "dragging", dragStarted: true, planetId: "1" });
    expect(controller.reorderPointerTarget("3", "after")).toEqual({
      movedPlanetId: "1",
      nextPlanetIds: ["2", "3", "1"],
    });
    expect(controller.finishPointer(8)).toEqual({ finished: true, wasDragging: true });
  });

  test("uses the same touch pointer path, mobile drop axis, and wallet-scoped persistence", () => {
    const controller = createPlanetPickerInteractionController();
    const storage = memoryStorage();
    controller.beginPointer({
      button: 0,
      clientX: 12,
      clientY: 12,
      orderIds: ["1", "2", "3"],
      planetId: "3",
      pointerId: 11,
      pointerType: "touch",
    });

    expect(controller.movePointer({
      clientX: 2,
      clientY: 12,
      pointerId: 11,
      pointerType: "touch",
    })).toEqual({ status: "dragging", dragStarted: true, planetId: "3" });
    const position = planetPickerDropPosition(
      "mobile",
      101,
      900,
      { height: 80, left: 100, top: 20, width: 100 },
    );
    const reordered = controller.reorderPointerTarget("1", position);
    expect(position).toBe("before");
    expect(reordered?.nextPlanetIds).toEqual(["3", "1", "2"]);

    writePlanetPickerOrder(storage, "0xAAA", reordered?.nextPlanetIds ?? []);
    expect(readPlanetPickerOrder(storage, "0xaaa")).toEqual(["3", "1", "2"]);
    expect(readPlanetPickerOrder(storage, "0xbbb")).toBeUndefined();
    expect(controller.finishPointer(11)).toEqual({ finished: true, wasDragging: true });
  });

  test("pointer cancel and pointer up both terminate drag state", () => {
    for (const pointerId of [21, 22]) {
      const controller = createPlanetPickerInteractionController();
      controller.beginPointer({
        button: 0,
        clientX: 0,
        clientY: 0,
        orderIds: ["1", "2"],
        planetId: "1",
        pointerId,
        pointerType: "touch",
      });
      controller.movePointer({
        clientX: 10,
        clientY: 0,
        pointerId,
        pointerType: "touch",
      });

      expect(controller.finishPointer(pointerId + 100)).toEqual({ finished: false, wasDragging: false });
      expect(controller.finishPointer(pointerId)).toEqual({ finished: true, wasDragging: true });
      expect(controller.reorderPointerTarget("2", "after")).toBeUndefined();
      expect(controller.movePointer({
        clientX: 20,
        clientY: 0,
        pointerId,
        pointerType: "touch",
      })).toEqual({ status: "ignored" });
    }
  });

  test("Arrow, Home, and End keyboard commands move the intended planet and can persist", () => {
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
