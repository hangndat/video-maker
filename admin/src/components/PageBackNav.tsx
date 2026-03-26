import { Button } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';

type PageBackNavProps = {
  label: string;
  onBack: () => void;
};

export function PageBackNav({ label, onBack }: PageBackNavProps) {
  return (
    <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack} style={{ alignSelf: 'flex-start' }}>
      {label}
    </Button>
  );
}
