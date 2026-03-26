import { useCallback, useEffect, useState } from 'react';
import { Card, Tag, theme } from 'antd';
import { PageContainer } from '@ant-design/pro-components';
import { adminFetch } from '../lib/api';

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
    <PageContainer title="Profiles (DATA_ROOT/profiles)">
      <Card>
        <div data-testid="profiles-list" style={{ display: 'flex', flexWrap: 'wrap', gap: token.marginXS }}>
          {profiles.map((p) => (
            <Tag key={p} data-profile-id={p}>
              {p}.json
            </Tag>
          ))}
        </div>
      </Card>
    </PageContainer>
  );
}
