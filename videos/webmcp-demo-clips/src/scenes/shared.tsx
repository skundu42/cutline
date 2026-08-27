import {Layout, Rect, Txt, View2D} from '@motion-canvas/2d';
import {all, createRef, easeInOutCubic, easeOutCubic, Reference, waitFor} from '@motion-canvas/core';

export const COLORS = {
  forest: '#0f2f27',
  forestDeep: '#071a16',
  forestSoft: '#1d493c',
  lime: '#bff56c',
  orange: '#ff7f52',
  paper: '#f7f8f3',
  ink: '#15231e',
  mint: '#d8f7d0',
  muted: '#9fb7ac',
  lavender: '#dcd5ee',
  line: '#33574a',
  white: '#ffffff',
};

export interface SceneCopy {
  number: string;
  kicker: string;
  title: string;
  subtitle: string;
  payoff: string;
}

export interface ChromeRefs {
  brand: Reference<Layout>;
  counter: Reference<Layout>;
  title: Reference<Txt>;
  subtitle: Reference<Txt>;
  payoff: Reference<Rect>;
  payoffText: Reference<Txt>;
  accent: Reference<Rect>;
}

export function setupScene(view: View2D, copy: SceneCopy): ChromeRefs {
  const brand = createRef<Layout>();
  const counter = createRef<Layout>();
  const title = createRef<Txt>();
  const subtitle = createRef<Txt>();
  const payoff = createRef<Rect>();
  const payoffText = createRef<Txt>();
  const accent = createRef<Rect>();

  view.fill(COLORS.forestDeep);
  view.add(
    <>
      <Rect width={1280} height={720} fill={COLORS.forestDeep} />
      <Rect
        width={1232}
        height={672}
        radius={24}
        fill={COLORS.forest}
        stroke={COLORS.line}
        lineWidth={2}
        shadowColor={'#00000055'}
        shadowBlur={36}
        shadowOffsetY={16}
      />
      {Array.from({length: 8}).map((_, index) => (
        <Rect
          key={`grid-v-${index}`}
          x={-540 + index * 154}
          width={1}
          height={672}
          fill={'#ffffff0b'}
        />
      ))}
      {Array.from({length: 5}).map((_, index) => (
        <Rect
          key={`grid-h-${index}`}
          y={-270 + index * 135}
          width={1232}
          height={1}
          fill={'#ffffff0b'}
        />
      ))}
      <Layout ref={brand} x={-522} y={-320} opacity={0}>
        <Rect width={34} height={34} radius={10} fill={COLORS.lime}>
          <Txt text={'C'} fill={COLORS.forestDeep} fontFamily={'Arial'} fontWeight={900} fontSize={20} />
        </Rect>
        <Txt
          x={64}
          text={'CUTLINE'}
          fill={COLORS.paper}
          fontFamily={'Arial'}
          fontWeight={800}
          fontSize={22}
          letterSpacing={3}
        />
        <Rect x={192} width={8} height={8} radius={4} fill={COLORS.orange} />
        <Txt
          x={280}
          text={'WEBMCP DEMO'}
          fill={COLORS.muted}
          fontFamily={'Arial'}
          fontWeight={700}
          fontSize={14}
          letterSpacing={2}
        />
      </Layout>
      <Layout ref={counter} x={520} y={-320} opacity={0}>
        <Rect width={122} height={34} radius={17} fill={'#ffffff0c'} stroke={COLORS.line} lineWidth={1} />
        <Txt
          text={`${copy.number} / 06  ·  10s`}
          fill={COLORS.muted}
          fontFamily={'Arial'}
          fontWeight={700}
          fontSize={13}
          letterSpacing={1}
        />
      </Layout>
      <Txt
        x={0}
        y={-266}
        width={1096}
        text={copy.kicker.toUpperCase()}
        fill={COLORS.lime}
        fontFamily={'Arial'}
        fontWeight={800}
        fontSize={16}
        letterSpacing={3}
        textAlign={'left'}
      />
      <Txt
        ref={title}
        x={0}
        y={-210}
        width={1096}
        text={copy.title}
        fill={COLORS.paper}
        fontFamily={'Arial'}
        fontWeight={800}
        fontSize={48}
        lineHeight={56}
        textAlign={'left'}
        opacity={0}
      />
      <Txt
        ref={subtitle}
        x={0}
        y={-138}
        width={1096}
        text={copy.subtitle}
        fill={COLORS.muted}
        fontFamily={'Arial'}
        fontWeight={500}
        fontSize={21}
        lineHeight={29}
        textAlign={'left'}
        opacity={0}
      />
      <Rect
        ref={payoff}
        x={0}
        y={292}
        width={1140}
        height={58}
        radius={18}
        fill={'#bff56c12'}
        stroke={'#bff56c55'}
        lineWidth={1}
        opacity={0}
      >
        <Rect x={-539} width={6} height={32} radius={3} fill={COLORS.lime} />
        <Txt
          ref={payoffText}
          x={0}
          width={1000}
          text={copy.payoff}
          fill={COLORS.paper}
          fontFamily={'Arial'}
          fontWeight={700}
          fontSize={18}
          textAlign={'left'}
        />
      </Rect>
      <Rect ref={accent} x={-570} y={334} width={0} height={3} radius={2} fill={COLORS.orange} />
    </>,
  );

  return {brand, counter, title, subtitle, payoff, payoffText, accent};
}

export function* animateIntro(chrome: ChromeRefs) {
  yield* all(
    chrome.brand().opacity(1, 0.6, easeOutCubic),
    chrome.brand().position.x(-502, 0.6, easeOutCubic),
    chrome.counter().opacity(1, 0.6, easeOutCubic),
  );
  yield* all(
    chrome.title().opacity(1, 0.9, easeOutCubic),
    chrome.title().position.y(-222, 0.9, easeOutCubic),
    chrome.subtitle().opacity(1, 0.9, easeOutCubic),
    chrome.subtitle().position.y(-146, 0.9, easeOutCubic),
  );
  yield* waitFor(0.4);
}

export function* animateOutro(chrome: ChromeRefs) {
  yield* all(
    chrome.payoff().opacity(1, 0.8, easeOutCubic),
    chrome.payoff().position.y(282, 0.8, easeOutCubic),
  );
  yield* chrome.accent().width(1140, 1.5, easeInOutCubic);
  yield* waitFor(2.4);
}

export function toolChip(text: string, x: number, y: number, color = COLORS.lime) {
  return (
    <Rect x={x} y={y} height={42} padding={[0, 18]} radius={12} fill={'#071a1699'} stroke={color} lineWidth={1}>
      <Txt text={text} fill={color} fontFamily={'monospace'} fontWeight={700} fontSize={16} />
    </Rect>
  );
}
