import { useCallback, useEffect, useState } from 'react';
import { Tag, theme } from 'antd';
import { adminFetch } from '../lib/api';
import { PageSectionCard } from '../components/PageSectionCard';
import { StandardAdminPage } from '../components/StandardAdminPage';

export default function Profiles() {
  const { token } = theme.useToken();
  const [profiles, setProfiles] = useState<string[]>([]);

  const load = useCallback(async () => {
    const r = await adminFetch('/admin/api/profiles');
    const j = (await r.json()) as { profiles?: string[] };
    setProfiles(j.profiles ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <StandardAdminPage
      title="Profiles"
      description="Danh sách file preset trong DATA_ROOT/profiles (*.json)."
    >
      <PageSectionCard>
        <div data-testid="profiles-list" style={{ display: 'flex', flexWrap: 'wrap', gap: token.marginXS }}>
          {profiles.map((p) => (
            <Tag key={p} data-profile-id={p}>
              {p}.json
            </Tag>
          ))}
        </div>
      </PageSectionCard>
    </StandardAdminPage>
  );
}
