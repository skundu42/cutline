import {Circle, Layout, Line, Rect, Txt, makeScene2D} from '@motion-canvas/2d';
import {all, createRef, easeInOutCubic, easeOutBack, easeOutCubic} from '@motion-canvas/core';
import {COLORS, animateIntro, animateOutro, setupScene} from './shared';

export default makeScene2D(function* (view) {
  const chrome = setupScene(view, {
    number: '03',
    kicker: 'Safe iteration',
    title: 'Every agent idea gets a reversible branch.',
    subtitle: 'Version checks prevent stale writes. Undo, redo, compare, and acceptance remain explicit.',
    payoff: 'Every actor can move fast without silently overwriting an accepted cut.',
  });
  const main = createRef<Rect>();
  const split = createRef<Line>();
  const agentCut = createRef<Rect>();
  const version = createRef<Rect>();
  const receipt = createRef<Rect>();

  view.add(
    <>
      <Rect ref={main} x={-350} y={42} width={300} height={160} radius={24} fill={COLORS.paper} opacity={0} scale={0.8}>
        <Circle x={-108} y={-50} width={14} height={14} fill={'#69c77d'} />
        <Txt x={-78} y={-50} text={'SOURCE'} fill={'#607068'} fontFamily={'Arial'} fontWeight={800} fontSize={13} letterSpacing={2} />
        <Txt x={-108} y={-5} text={'Main cut'} fill={COLORS.ink} fontFamily={'Arial'} fontWeight={800} fontSize={25} />
        <Txt x={-108} y={38} text={'branch_main  ·  v12'} fill={'#607068'} fontFamily={'monospace'} fontSize={14} />
      </Rect>
      <Line ref={split} points={[[-185, 42], [-95, 42], [-35, 108], [55, 108]]} stroke={COLORS.lime} lineWidth={5} endArrow arrowSize={13} end={0} />
      <Rect ref={agentCut} x={245} y={108} width={360} height={180} radius={26} fill={COLORS.forestSoft} stroke={COLORS.lime} lineWidth={2} opacity={0} scale={0.75}>
        <Rect x={-132} y={-60} width={70} height={28} radius={14} fill={COLORS.lime}>
          <Txt text={'NEW'} fill={COLORS.forestDeep} fontFamily={'Arial'} fontWeight={900} fontSize={12} letterSpacing={1} />
        </Rect>
        <Txt x={-132} y={-12} text={'Punchy short'} fill={COLORS.paper} fontFamily={'Arial'} fontWeight={800} fontSize={28} />
        <Txt x={-132} y={34} text={'agent_cut  ·  working'} fill={COLORS.muted} fontFamily={'monospace'} fontSize={14} />
        <Layout y={70}>
          <Rect x={-80} width={88} height={28} radius={10} fill={'#ffffff12'}><Txt text={'UNDO'} fill={COLORS.paper} fontFamily={'Arial'} fontWeight={700} fontSize={12} /></Rect>
          <Rect x={20} width={88} height={28} radius={10} fill={'#ffffff12'}><Txt text={'REDO'} fill={COLORS.paper} fontFamily={'Arial'} fontWeight={700} fontSize={12} /></Rect>
          <Rect x={120} width={88} height={28} radius={10} fill={COLORS.orange}><Txt text={'COMPARE'} fill={COLORS.forestDeep} fontFamily={'Arial'} fontWeight={800} fontSize={12} /></Rect>
        </Layout>
      </Rect>
      <Rect ref={version} x={45} y={-18} width={178} height={44} radius={15} fill={'#071a16'} stroke={COLORS.orange} lineWidth={1} opacity={0}>
        <Txt text={'expectedVersion: 12'} fill={COLORS.orange} fontFamily={'monospace'} fontWeight={700} fontSize={14} />
      </Rect>
      <Rect ref={receipt} x={405} y={-52} width={250} height={60} radius={17} fill={COLORS.mint} opacity={0}>
        <Circle x={-96} width={18} height={18} fill={'#3d8f50'}><Txt text={'✓'} fill={COLORS.white} fontFamily={'Arial'} fontWeight={900} fontSize={12} /></Circle>
        <Txt x={18} text={'branchVersion → 13'} fill={COLORS.ink} fontFamily={'monospace'} fontWeight={700} fontSize={14} />
      </Rect>
    </>,
  );

  yield* animateIntro(chrome);
  yield* all(main().opacity(1, 1, easeOutCubic), main().scale(1, 1, easeOutBack), version().opacity(1, 1, easeOutCubic));
  yield* all(split().end(1, 1.2, easeInOutCubic), agentCut().opacity(1, 1.2, easeOutCubic), agentCut().scale(1, 1.2, easeOutBack));
  yield* all(receipt().opacity(1, 1.2, easeOutCubic), receipt().position.y(-38, 1.2, easeOutCubic), version().stroke(COLORS.lime, 1.2));
  yield* animateOutro(chrome);
});
