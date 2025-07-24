import { useStore } from '@/store/store';
import { Link } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';

export function CamSourceSelector() {
  // Select camSources object itself (stable reference) to avoid creating new array each hook call
  const camSources = useStore(state => state.camSources);
  const camNames = Object.keys(camSources);
  const active = useStore(state => state.activeCamName ?? '');
  const setActive = useStore(state => state.setActiveCam);

  return (
    <div className="flex flex-col gap-2 p-2">
      <Select value={active} onValueChange={setActive}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select camera" />
        </SelectTrigger>
        <SelectContent>
          {camNames.map(name => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" asChild>
        <Link to="/setup/url-entry" search={{ new: true }}>
          Add Camera
        </Link>
      </Button>
    </div>
  );
}
