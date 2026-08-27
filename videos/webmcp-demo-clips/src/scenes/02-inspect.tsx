import {Layout, Line, Rect, Txt, makeScene2D} from '@motion-canvas/2d';
import {all, createRef, easeInOutCubic, easeOutBack, easeOutCubic, sequence} from '@motion-canvas/core';
import {COLORS, animateIntro, animateOutro, setupScene} from './shared';

export default makeScene2D(function* (view) {
  const chrome = setupScene(view, {
    number: '02',
    kicker: 'Read before write',
    title: 'Inspect first. Edit with context.',
    subtitle: 'Assets, tracks, locks, comments, and branch versions arrive as bounded structured state.',
    payoff: 'The agent plans from real project state instead of guessing what is on screen.',
  });
  const request = createRef<Rect>();
  const line = createRef<Line>();
  const state = createRef<Rect>();
  const rows = [createRef<Layout>(), createRef<Layout>(), createRef<Layout>()];

  view.add(
    <>
      <Rect
        ref={request}
        x={-370}
        y={48}
        width={310}
        height={190}
        radius={22}
        fill={'#071a16cc'}
        stroke={COLORS.lime}
        lineWidth={2}
        opacity={0}
        scale={0.8}
      >
        <Txt y={-58} text={'TOOL CALL'} fill={COLORS.muted} fontFamily={'Arial'} fontWeight={800} fontSize={13} letterSpacing={2} />
        <Txt y={-12} text={'inspect_project'} fill={COLORS.lime} fontFamily={'monospace'} fontWeight={700} fontSize={22} />
        <Rect y={48} width={242} height={42} radius={10} fill={COLORS.forestSoft}>
          <Txt text={'include: [tracks, locks]'} fill={COLORS.paper} fontFamily={'monospace'} fontSize={13} />
        </Rect>
      </Rect>
      <Line ref={line} points={[[-195, 48], [-105, 48]]} stroke={COLORS.orange} lineWidth={4} endArrow arrowSize={12} end={0} />
      <Rect
        ref={state}
        x={220}
        y={48}
        width={540}
        height={245}
        radius={24}
        fill={COLORS.paper}
        stroke={'#ffffff55'}
        lineWidth={2}
        opacity={0}
        scale={0.88}
      >
        <Txt x={-205} y={-92} text={'PROJECT STATE'} fill={COLORS.ink} fontFamily={'Arial'} fontWeight={900} fontSize={15} letterSpacing={2} />
        <Rect x={205} y={-92} width={84} height={28} radius={14} fill={COLORS.mint}>
          <Txt text={'v12'} fill={COLORS.ink} fontFamily={'monospace'} fontWeight={800} fontSize={13} />
        </Rect>
        <Layout ref={rows[0]} opacity={0} y={18}>
          <Rect y={-35} width={454} height={42} radius={9} fill={'#e8ece6'}>
            <Txt x={-170} text={'4 assets'} fill={COLORS.ink} fontFamily={'Arial'} fontWeight={700} fontSize={15} />
            <Txt x={140} text={'browser-local'} fill={'#607068'} fontFamily={'monospace'} fontSize={13} />
          </Rect>
        </Layout>
        <Layout ref={rows[1]} opacity={0} y={18}>
          <Rect y={20} width={454} height={42} radius={9} fill={'#d9f1bc'}>
            <Txt x={-162} text={'5 tracks'} fill={COLORS.ink} fontFamily={'Arial'} fontWeight={700} fontSize={15} />
            <Txt x={139} text={'V1 · V2 · A1 · A2 · CC'} fill={'#48614f'} fontFamily={'monospace'} fontSize={12} />
          </Rect>
        </Layout>
        <Layout ref={rows[2]} opacity={0} y={18}>
          <Rect y={75} width={454} height={42} radius={9} fill={'#ffe1d5'}>
            <Txt x={-155} text={'2 locks'} fill={COLORS.ink} fontFamily={'Arial'} fontWeight={700} fontSize={15} />
            <Txt x={145} text={'shared lock'} fill={'#81442f'} fontFamily={'monospace'} fontSize={13} />
          </Rect>
        </Layout>
      </Rect>
    </>,
  );

  yield* animateIntro(chrome);
  yield* all(request().opacity(1, 1, easeOutCubic), request().scale(1, 1, easeOutBack));
  yield* all(line().end(1, 1.2, easeInOutCubic), state().opacity(1, 1.2, easeOutCubic), state().scale(1, 1.2, easeOutBack));
  yield* sequence(
    0.2,
    all(rows[0]().opacity(1, 0.8, easeOutCubic), rows[0]().position.y(0, 0.8, easeOutCubic)),
    all(rows[1]().opacity(1, 0.8, easeOutCubic), rows[1]().position.y(0, 0.8, easeOutCubic)),
    all(rows[2]().opacity(1, 0.8, easeOutCubic), rows[2]().position.y(0, 0.8, easeOutCubic)),
  );
  yield* animateOutro(chrome);
});
