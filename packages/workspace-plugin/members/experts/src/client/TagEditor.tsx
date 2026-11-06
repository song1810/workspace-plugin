import { Button, Input, Select } from 'workspace-ui';
import * as React from 'react';
import { useRef } from 'react';
import { EXPERT_LIMITS, isBilingualTag, sanitizeBilingualTag } from '../shared.js';

export function TagEditor({
  tags,
  options,
  onChange,
  label = '标签',
  max = EXPERT_LIMITS.tagsMax,
}: {
  readonly tags: readonly string[];
  readonly options: readonly string[];
  readonly onChange: (tags: string[]) => void;
  readonly label?: string;
  readonly max?: number;
}) {
  const composing = useRef<number | null>(null);
  const available = options.filter(option => isBilingualTag(option) && !tags.includes(option));
  const add = (tag: string) => {
    const value = sanitizeBilingualTag(tag.trim());
    if (!isBilingualTag(value) || tags.includes(value) || tags.length >= max) return;
    onChange([...tags, value]);
  };
  return <div className="tag-editor">
    <div className="tag-editor-head"><strong>{label}</strong><small>支持中英文，最多 {max} 个，每个 ≤{EXPERT_LIMITS.tagCharsMax} 字</small></div>
    <div className="tag-editor-rows">
      {tags.map((tag, index) => <div className="tag-editor-row" key={index}>
        <Input value={tag} maxLength={EXPERT_LIMITS.tagCharsMax * 2} aria-label={`${label} ${index + 1}`}
          placeholder="请输入中文或英文标签" title="支持中文、英文和数字"
          onCompositionStart={() => { composing.current = index; }}
          onCompositionEnd={event => {
            composing.current = null;
            const value = sanitizeBilingualTag(event.currentTarget.value).trim();
            onChange(tags.map((item, i) => i === index ? value : item));
          }}
          onBlur={event => {
            if (composing.current !== index) return;
            composing.current = null;
            const value = sanitizeBilingualTag(event.currentTarget.value).trim();
            onChange(tags.map((item, i) => i === index ? value : item));
          }}
          onChange={event => {
            const raw = event.currentTarget.value;
            const value = composing.current === index
              ? Array.from(raw).slice(0, EXPERT_LIMITS.tagCharsMax * 2).join('')
              : sanitizeBilingualTag(raw);
            onChange(tags.map((item, i) => i === index ? value : item));
          }} />
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
