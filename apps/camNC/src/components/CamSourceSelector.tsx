import { useActiveCamId, useAllCamSources, useSetActiveCam } from '@/store/store';
import { Link } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';

export function CamSourceSelector() {
  const camSources = useAllCamSources();
  const activeCamId = useActiveCamId();
  const setActiveCam = useSetActiveCam();

  // Create array of [id, name] pairs for the select options
  const camOptions = Object.entries(camSources).map(([id, source]) => ({
    id,
    name: source.name,
  }));

  return (
    <div className="flex flex-col gap-2 p-2">
      <Select value={activeCamId ?? ''} onValueChange={setActiveCam}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select camera" />
        </SelectTrigger>
        <SelectContent>
          {camOptions.map(({ id, name }) => (
            <SelectItem key={id} value={id}>
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
