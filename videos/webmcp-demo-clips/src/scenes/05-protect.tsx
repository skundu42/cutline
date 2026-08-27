import {Circle, Layout, Rect, Txt, makeScene2D} from '@motion-canvas/2d';
import {all, createRef, easeInOutCubic, easeOutBack, easeOutCubic} from '@motion-canvas/core';
import {COLORS, animateIntro, animateOutro, setupScene} from './shared';

export default makeScene2D(function* (view) {
  const chrome = setupScene(view, {
    number: '05',
    kicker: 'Shared control',
    title: 'Protected means protected.',
    subtitle: 'Versioned locks block intersecting edits and return a structured explanation to every actor.',
    payoff: 'Users and agents share authority. Attribution, receipts, and versions keep intent explicit.',
  });
  const timeline = createRef<Rect>();
  const lockBand = createRef<Rect>();
  const command = createRef<Rect>();
  const collision = createRef<Circle>();
  const error = createRef<Rect>();

  view.add(
    <>
      <Rect ref={timeline} x={-170} y={52} width={690} height={235} radius={25} fill={COLORS.paper} opacity={0} scale={0.88}>
        <Txt x={-290} y={-90} text={'V1  TIMELINE'} fill={'#607068'} fontFamily={'Arial'} fontWeight={800} fontSize={13} letterSpacing={2} />
        <Rect y={-28} width={590} height={58} radius={12} fill={'#b9d9c6'} />
        <Rect x={-180} y={-28} width={190} height={48} radius={9} fill={'#9fcab0'}><Txt text={'INTRO'} fill={COLORS.ink} fontFamily={'Arial'} fontWeight={800} fontSize={14} /></Rect>
        <Rect x={60} y={-28} width={260} height={48} radius={9} fill={'#d9f1bc'}><Txt text={'KEY MESSAGE'} fill={COLORS.ink} fontFamily={'Arial'} fontWeight={800} fontSize={14} /></Rect>
        <Rect x={235} y={-28} width={80} height={48} radius={9} fill={'#c5ddb0'}><Txt text={'END'} fill={COLORS.ink} fontFamily={'Arial'} fontWeight={800} fontSize={12} /></Rect>
        <Rect ref={lockBand} x={60} y={-28} width={0} height={78} radius={12} fill={'#ff7f5233'} stroke={COLORS.orange} lineWidth={2}>
          <Layout y={-54}>
            <Rect width={182} height={30} radius={15} fill={COLORS.orange}>
              <Txt text={'🔒  KEEP THIS BEAT'} fill={COLORS.forestDeep} fontFamily={'Arial'} fontWeight={900} fontSize={12} letterSpacing={1} />
            </Rect>
          </Layout>
        </Rect>
        <Rect x={-280} y={70} width={560} height={6} radius={3} fill={'#d4dad5'} />
        <Rect x={-68} y={70} width={140} height={6} radius={3} fill={COLORS.orange} />
      </Rect>
      <Rect ref={command} x={355} y={5} width={290} height={130} radius={22} fill={'#071a16ee'} stroke={COLORS.lime} lineWidth={2} opacity={0} scale={0.75}>
        <Txt y={-32} text={'ripple_delete'} fill={COLORS.lime} fontFamily={'monospace'} fontWeight={800} fontSize={17} />
        <Txt y={15} text={'04.2s → 06.8s'} fill={COLORS.paper} fontFamily={'monospace'} fontSize={14} />
        <Txt y={46} text={'required: true'} fill={COLORS.muted} fontFamily={'monospace'} fontSize={12} />
      </Rect>
      <Circle ref={collision} x={290} y={58} width={0} height={0} fill={COLORS.orange} opacity={0}>
        <Txt text={'!'} fill={COLORS.forestDeep} fontFamily={'Arial'} fontWeight={900} fontSize={24} />
      </Circle>
      <Rect ref={error} x={355} y={142} width={360} height={78} radius={18} fill={'#ffe1d5'} stroke={COLORS.orange} lineWidth={1} opacity={0}>
        <Txt x={-145} y={-18} text={'LOCKED_RANGE'} fill={'#803f2a'} fontFamily={'monospace'} fontWeight={900} fontSize={15} />
        <Txt x={-145} y={18} text={'Edit skipped · state unchanged'} fill={'#6b554d'} fontFamily={'Arial'} fontWeight={700} fontSize={14} />
      </Rect>
    </>,
  );

  yield* animateIntro(chrome);
  yield* all(timeline().opacity(1, 1, easeOutCubic), timeline().scale(1, 1, easeOutBack), lockBand().width(260, 1, easeInOutCubic));
  yield* all(command().opacity(1, 1.2, easeOutCubic), command().scale(1, 1.2, easeOutBack), command().position.x(320, 1.2, easeOutCubic));
  yield* all(collision().opacity(1, 1.2, easeOutCubic), collision().size(58, 1.2, easeOutBack), error().opacity(1, 1.2, easeOutCubic), error().position.y(128, 1.2, easeOutCubic));
  yield* animateOutro(chrome);
});
