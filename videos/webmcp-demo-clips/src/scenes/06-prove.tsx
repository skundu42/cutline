import {Circle, Layout, Rect, Txt, makeScene2D} from '@motion-canvas/2d';
import {all, createRef, easeOutBack, easeOutCubic, sequence} from '@motion-canvas/core';
import {COLORS, animateIntro, animateOutro, setupScene} from './shared';

export default makeScene2D(function* (view) {
  const chrome = setupScene(view, {
    number: '06',
    kicker: 'Visible proof',
    title: 'Same state. Same preview. Verifiable result.',
    subtitle: 'Compare branches, inspect receipts, preview exact ranges, then export the verified cut locally.',
    payoff: 'Cutline turns WebMCP into a shared creative operating system.',
  });
  const monitor = createRef<Rect>();
  const leftCut = createRef<Rect>();
  const rightCut = createRef<Rect>();
  const receipt = createRef<Rect>();
  const exportGate = createRef<Rect>();
  const checkOne = createRef<Layout>();
  const checkTwo = createRef<Layout>();
  const checkThree = createRef<Layout>();

  view.add(
    <>
      <Rect ref={monitor} x={-270} y={42} width={500} height={265} radius={24} fill={'#071a16'} stroke={COLORS.lime} lineWidth={2} opacity={0} scale={0.86}>
        <Rect y={-105} width={500} height={42} radius={[24, 24, 0, 0]} fill={COLORS.forestSoft}>
          <Circle x={-215} width={9} height={9} fill={COLORS.orange} />
          <Txt x={-165} text={'PROGRAM'} fill={COLORS.paper} fontFamily={'Arial'} fontWeight={800} fontSize={13} letterSpacing={2} />
          <Txt x={180} text={'16:9'} fill={COLORS.muted} fontFamily={'monospace'} fontSize={12} />
        </Rect>
        <Rect y={12} width={425} height={165} radius={14} fill={'#183b31'}>
          <Rect width={340} height={106} radius={14} fill={'#d9f1bc'}>
            <Txt text={'VISIBLE PREVIEW'} fill={COLORS.ink} fontFamily={'Arial'} fontWeight={900} fontSize={22} letterSpacing={1} />
          </Rect>
          <Rect x={-136} y={62} width={70} height={22} radius={11} fill={COLORS.orange}>
            <Txt text={'LIVE'} fill={COLORS.forestDeep} fontFamily={'Arial'} fontWeight={900} fontSize={10} />
          </Rect>
        </Rect>
      </Rect>
      <Rect ref={leftCut} x={160} y={-28} width={230} height={90} radius={18} fill={COLORS.lavender} opacity={0}>
        <Txt y={-20} text={'SOURCE'} fill={'#625c70'} fontFamily={'Arial'} fontWeight={800} fontSize={12} letterSpacing={2} />
        <Txt y={18} text={'42.8s'} fill={COLORS.ink} fontFamily={'monospace'} fontWeight={900} fontSize={22} />
      </Rect>
      <Rect ref={rightCut} x={410} y={-28} width={230} height={90} radius={18} fill={COLORS.mint} opacity={0}>
        <Txt y={-20} text={'AGENT CUT'} fill={'#48614f'} fontFamily={'Arial'} fontWeight={800} fontSize={12} letterSpacing={2} />
        <Txt y={18} text={'36.4s'} fill={COLORS.ink} fontFamily={'monospace'} fontWeight={900} fontSize={22} />
      </Rect>
      <Rect ref={receipt} x={285} y={82} width={480} height={78} radius={19} fill={COLORS.paper} opacity={0}>
        <Circle x={-205} width={28} height={28} fill={'#3d8f50'}><Txt text={'✓'} fill={COLORS.white} fontFamily={'Arial'} fontWeight={900} fontSize={16} /></Circle>
        <Txt x={20} y={-14} text={'Applied 7 of 7 requested edits'} fill={COLORS.ink} fontFamily={'Arial'} fontWeight={800} fontSize={16} />
        <Txt x={20} y={17} text={'digest: sha256:9a4f…'} fill={'#607068'} fontFamily={'monospace'} fontSize={13} />
      </Rect>
      <Rect ref={exportGate} x={285} y={170} width={480} height={62} radius={18} fill={COLORS.orange} opacity={0} scale={0.85}>
        <Txt x={-125} text={'VERSION VERIFIED'} fill={COLORS.forestDeep} fontFamily={'Arial'} fontWeight={900} fontSize={13} letterSpacing={1} />
        <Txt x={150} text={'EXPORT →'} fill={COLORS.forestDeep} fontFamily={'Arial'} fontWeight={900} fontSize={15} />
      </Rect>
      <Layout ref={checkOne} opacity={0}><Txt x={95} y={212} text={'compare'} fill={COLORS.lime} fontFamily={'monospace'} fontWeight={700} fontSize={13} /></Layout>
      <Layout ref={checkTwo} opacity={0}><Txt x={248} y={212} text={'preview'} fill={COLORS.lime} fontFamily={'monospace'} fontWeight={700} fontSize={13} /></Layout>
      <Layout ref={checkThree} opacity={0}><Txt x={400} y={212} text={'receipt'} fill={COLORS.lime} fontFamily={'monospace'} fontWeight={700} fontSize={13} /></Layout>
    </>,
  );

  yield* animateIntro(chrome);
  yield* all(monitor().opacity(1, 1, easeOutCubic), monitor().scale(1, 1, easeOutBack));
  yield* all(leftCut().opacity(1, 1.2, easeOutCubic), leftCut().position.y(-18, 1.2, easeOutCubic), rightCut().opacity(1, 1.2, easeOutCubic), rightCut().position.y(-18, 1.2, easeOutCubic));
  yield* sequence(
    0.16,
    all(receipt().opacity(1, 0.88, easeOutCubic), receipt().position.y(72, 0.88, easeOutCubic)),
    all(exportGate().opacity(1, 0.88, easeOutCubic), exportGate().scale(1, 0.88, easeOutBack)),
    all(checkOne().opacity(1, 0.88, easeOutCubic), checkTwo().opacity(1, 0.88, easeOutCubic), checkThree().opacity(1, 0.88, easeOutCubic)),
  );
  yield* animateOutro(chrome);
});
