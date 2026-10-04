import { useState } from 'react';
import { expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HtmlReadingProfile } from './HtmlReadingProfile';
import { defaultSettings, resolveReadingProfile, type ReadingProfileOverride } from '../../lib/html-reading/model';

it('shows effective inherited values and resets only the selected section',()=>{
  function Fixture() {
    const [override,setOverride]=useState<ReadingProfileOverride>({perChannel:7,historyCount:3,cardFields:['summary'],detailModes:{summary:'omit'},detailOrder:['stars','summary']});
    return <HtmlReadingProfile title="测试频道" quantity inherited={resolveReadingProfile(defaultSettings,'trending')} override={override} onChange={setOverride}/>;
  }
  render(<Fixture/>);
  expect(screen.getByText(/生效数量：每频道／每期 7 项（单独调整）/)).toBeInTheDocument();
  expect(screen.getByLabelText('AI 摘要')).toHaveValue('omit');
  fireEvent.click(screen.getByRole('button',{name:'详情栏目恢复继承'}));
  expect(screen.getByLabelText('AI 摘要')).toHaveValue('inherit');
  expect(screen.getByLabelText('每频道／每期项目上限')).toHaveValue(7);
  expect(screen.getByText('栏目顺序：单独调整')).toBeInTheDocument();
  expect(screen.getByText('生效卡片（单独调整）：完整摘要／描述')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'数量恢复继承'}));
  expect(screen.getByLabelText('每频道／每期项目上限')).toHaveValue(defaultSettings.perChannel);
  expect(screen.getByText('栏目顺序：单独调整')).toBeInTheDocument();
});
