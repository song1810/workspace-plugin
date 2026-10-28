import { Button, Input, Select } from 'workspace-ui';
import * as React from 'react';

export function TagEditor({
  tags,
  options,
  onChange,
  label = '标签',
  max = 20,
}: {
  readonly tags: readonly string[];
  readonly options: readonly string[];
  readonly onChange: (tags: string[]) => void;
  readonly label?: string;
  readonly max?: number;
}) {
  const available = options.filter(option => !tags.includes(option));
  const add = (tag: string) => {
    const value = tag.trim();
    if (!value || tags.includes(value) || tags.length >= max) return;
    onChange([...tags, value]);
  };
  return <div className="tag-editor">
    <div className="tag-editor-head"><strong>{label}</strong><small>最多 {max} 个，每个 ≤20 字</small></div>
    <div className="tag-editor-rows">
      {tags.map((tag, index) => <div className="tag-editor-row" key={`${tag}-${index}`}>
        <Input value={tag} maxLength={20} aria-label={`${label} ${index + 1}`}
          onChange={event => onChange(tags.map((item, i) => i === index ? event.currentTarget.value : item))} />
        <Button variant="ghost" size="sm" className="remove" aria-label={`删除标签 ${index + 1}`}
          onClick={() => onChange(tags.filter((_, i) => i !== index))}>删除</Button>
      </div>)}
    </div>
    <div className="tag-editor-actions">
      {tags.length < max && <Button onClick={() => onChange([...tags, ''])}>+ 新建标签</Button>}
      {tags.length < max && available.length > 0 && <Select aria-label="从已有标签选择" value=""
        onChange={event => { if (event.currentTarget.value) add(event.currentTarget.value); event.currentTarget.value = ''; }}>
        <option value="">从已有标签选择</option>
        {available.map(option => <option key={option} value={option}>{option}</option>)}
      </Select>}
    </div>
  </div>;
}
