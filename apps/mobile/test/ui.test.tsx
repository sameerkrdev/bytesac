import { fireEvent, render, screen } from "@testing-library/react-native";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { TextField } from "@/components/ui/text-field";

describe("ui primitives", () => {
  it("Button fires and is disabled while loading", async () => {
    const onPress = jest.fn();
    const { rerender } = await render(<Button onPress={onPress}>Sign message</Button>);
    await fireEvent.press(screen.getByRole("button", { name: "Sign message" }));
    expect(onPress).toHaveBeenCalledTimes(1);
    await rerender(<Button onPress={onPress} loading>Sign message</Button>);
    expect(screen.getByRole("button", { name: "Sign message" })).toBeDisabled();
  });
  it("StatusBadge shows text, not only color", async () => {
    await render(<StatusBadge tone="success" label="Verified" />);
    expect(screen.getByText("Verified")).toBeOnTheScreen();
  });
  it("TextField links label and error", async () => {
    await render(<TextField label="Email address" value="x" onChangeText={() => undefined} error="Enter a valid email address" />);
    expect(screen.getByLabelText("Email address")).toBeOnTheScreen();
    expect(screen.getByText("Enter a valid email address")).toBeOnTheScreen();
  });
});
