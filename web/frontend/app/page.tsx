'use client';
import { NewVideoForm } from '@/components/NewVideoForm';
import { SetupChecklist, useSystemStatus } from '@/components/SetupChecklist';
import { VideoList } from '@/components/VideoList';

export default function Home() {
  const system = useSystemStatus();
  return (
    <div className="home">
      <NewVideoForm system={system.status} />
      <aside className="side">
        <VideoList />
        <SetupChecklist {...system} />
      </aside>
    </div>
  );
}
