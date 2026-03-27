import { useState } from 'react';
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import {
  ProConfigProvider,
  ProLayout,
  PageContainer,
  viVNIntl,
} from '@ant-design/pro-components';
import { App as AntdApp, Button, ConfigProvider, Input, Space } from 'antd';
import viVN from 'antd/locale/vi_VN';
import {
  CloudServerOutlined,
  ExperimentOutlined,
  FileImageOutlined,
  FolderOutlined,
  PlayCircleOutlined,
  ScheduleOutlined,
} from '@ant-design/icons';
import HealthTest from './pages/HealthTest';
import Jobs from './pages/Jobs';
import JobDetail from './pages/JobDetail';
import Render from './pages/Render';
import FromVideo from './pages/FromVideo';
import Profiles from './pages/Profiles';
import { getAdminToken, setAdminToken } from './lib/api';

const route = {
  path: '/',
  routes: [
    { path: '/', name: 'Kiểm thử & Health', icon: <ExperimentOutlined /> },
    { path: '/jobs', name: 'Jobs', icon: <FolderOutlined /> },
    { path: '/render', name: 'Render mới', icon: <PlayCircleOutlined /> },
    { path: '/from-video', name: 'From video', icon: <ScheduleOutlined /> },
    { path: '/profiles', name: 'Profiles', icon: <FileImageOutlined /> },
  ],
};

function LayoutContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const [tokenInput, setTokenInput] = useState(getAdminToken);

  return (
    <ProLayout
      title="Video Maker Admin"
      logo={<CloudServerOutlined style={{ fontSize: 24 }} />}
      layout="mix"
      fixedHeader
      fixSiderbar
      token={{
        pageContainer: {
          paddingInlinePageContainerContent: 0,
          paddingBlockPageContainerContent: 0,
        },
      }}
      location={{ pathname: location.pathname }}
      route={route}
      menuItemRender={(item, dom) => {
        if (item.path && !item.isUrl) {
          return <Link to={item.path}>{dom}</Link>;
        }
        return dom;
      }}
      subMenuItemRender={(_, dom) => dom}
      actionsRender={() => [
        <Space key="token" data-testid="admin-token-bar" style={{ marginRight: 8 }}>
          <Input.Password
            placeholder="ADMIN_API_TOKEN"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            style={{ width: 220 }}
            data-testid="input-admin-token"
          />
          <Button
            size="small"
            type="primary"
            onClick={() => {
              setAdminToken(tokenInput);
              navigate(0);
            }}
            data-testid="btn-save-admin-token"
          >
            Lưu token
          </Button>
        </Space>,
      ]}
      menu={{ collapsedShowTitle: true }}
    >
      <PageContainer fixHeader pageHeaderRender={false}>
        <div className="cc-main-content-surface">
          <Routes>
            <Route path="/" element={<HealthTest />} />
            <Route path="/jobs" element={<Jobs />} />
            <Route path="/jobs/:jobId" element={<JobDetail />} />
            <Route path="/render" element={<Render />} />
            <Route path="/from-video" element={<FromVideo />} />
            <Route path="/profiles" element={<Profiles />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </PageContainer>
    </ProLayout>
  );
}

const theme = {
  token: {
    colorPrimary: '#722ed1',
    borderRadius: 6,
  },
};

export default function App() {
  return (
    <ConfigProvider locale={viVN} theme={theme}>
      <AntdApp>
        <ProConfigProvider token={theme.token} intl={viVNIntl}>
          <BrowserRouter basename="/admin">
            <LayoutContent />
          </BrowserRouter>
        </ProConfigProvider>
      </AntdApp>
    </ConfigProvider>
  );
}
