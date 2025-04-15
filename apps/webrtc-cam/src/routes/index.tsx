import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@wbcnc/ui/components/button";

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div>
      <Button>hello</Button>
      Hello "/"!
    </div>
  );
}
