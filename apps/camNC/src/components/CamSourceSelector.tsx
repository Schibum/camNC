import { useStore } from '@/store/store';
import { Button } from '@wbcnc/ui/components/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wbcnc/ui/components/select';
import { useNavigate } from '@tanstack/react-router';

export function CamSourceSelector() {
  const camNames = useStore(state => Object.keys(state.camSources));
  const active = useStore(state => state.activeCamName ?? '');
  const setActive = useStore(state => state.setActiveCam);
  const navigate = useNavigate();

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
      <Button size="sm" onClick={() => navigate({ to: '/setup/url-entry' })}>
        Add Camera
      </Button>
    </div>
  );
}
