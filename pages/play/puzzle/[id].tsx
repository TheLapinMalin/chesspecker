import {useState, useEffect, useCallback, ReactElement} from 'react';
import * as ChessJS from 'chess.js';
import {ChessInstance, Square, ShortMove} from 'chess.js';
import type {Config} from 'chessground/config';
import {useAtom} from 'jotai';
import {useRouter} from 'next/router';
import type {GetServerSidePropsContext, Redirect} from 'next';
import {NextSeo} from 'next-seo';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {useSound} from 'use-sound';
import {Puzzle} from '@/models/puzzle';
import Layout from '@/layouts/main';
import {configµ, orientationµ, animationµ, playµ} from '@/lib/atoms';
import MOVE from '@/sounds/Move.mp3';
import CAPTURE from '@/sounds/Capture.mp3';
import ERROR from '@/sounds/Error.mp3';
import GENERIC from '@/sounds/GenericNotify.mp3';
import useModal from '@/hooks/use-modal';
import useKeyPress from '@/hooks/use-key-press';
import {Button} from '@/components/button';
import {withSessionSsr} from '@/lib/session';
import {get_} from '@/lib/api-helpers';
import {getGrade, parseGrade} from '@/lib/grades';
import {getColor, getTime} from '@/lib/play';
import type {Stat} from '@/components/modal-puzzle';
import MoveToNext from '@/components/play/right-bar/move-to-next';
import {sleep} from '@/lib/utils';
import Board from '@/components/play/board';
import Solution from '@/components/play/right-bar/solution';

const Timer = dynamic(async () => import('@/components/play/timer'));
const ModalPuzzle = dynamic(async () => import('@/components/modal-puzzle'));
const BottomBar = dynamic(async () => import('@/components/play/bottom-bar'));

const Chess = typeof ChessJS === 'function' ? ChessJS : ChessJS.Chess;

type Props = {puzzle: Puzzle};
const PlayingPage = ({puzzle}: Props) => {
	const [hasAutoMove] = useAtom(configµ.autoMove);
	const [hasSound] = useAtom(configµ.sound);
	const [hasAnimation] = useAtom(configµ.animation);

	const [playMove] = useSound(MOVE);
	const [playCapture] = useSound(CAPTURE);
	const [playError] = useSound(ERROR);
	const [playGeneric] = useSound(GENERIC, {volume: 0.3});

	const [isSolutionClicked, setIsSolutionClicked] = useAtom(playµ.solution);
	const [initialPuzzleTimer, setInitialPuzzleTimer] = useAtom(playµ.timer);

	const [orientation, setOrientation] = useAtom(orientationµ);
	const [, setAnimation] = useAtom(animationµ);

	const [chess, setChess] = useState<ChessInstance>(new Chess());
	const [config, setConfig] = useState<Partial<Config>>();

	const [moveNumber, setMoveNumber] = useState(0);
	const [moveHistory, setMoveHistory] = useState<string[]>([]);
	const [lastMove, setLastMove] = useState<Square[]>([]);
	const [mistakes, setMistakes] = useState(0);
	const [isRunning, setIsRunning] = useState(true);
	const [pendingMove, setPendingMove] = useState<Square[]>([]);
	const {isOpen, show, hide} = useModal();
	const router = useRouter();

	const [showModal, setShowModal] = useState(false);
	const [stat, setStat] = useState<Stat>({
		mistakes: 0,
		time: 0,
		grade: '',
	});

	const cleanAnimation = useCallback(
		async () =>
			sleep(600)
				.then(() => {
					setAnimation(() => '');
				})
				.catch(console.error),
		/* eslint-disable-next-line react-hooks/exhaustive-deps */
		[],
	);

	/**
	 * Setup the board.
	 */
	useEffect(() => {
		if (!puzzle?.Moves) return;
		const chess = new Chess(puzzle.FEN);
		setChess(() => chess);
		setMoveHistory(() => puzzle.Moves.split(' '));
		setMoveNumber(() => 0);
		setLastMove(() => []);
		setPendingMove(() => []);
		setOrientation(() => (chess.turn() === 'b' ? 'white' : 'black'));
		setInitialPuzzleTimer(() => Date.now());
		setIsSolutionClicked(() => false);

		const config: Partial<Config> = {
			fen: chess.fen(),
			check: chess.in_check(),
			animation: {enabled: true, duration: 50},
			turnColor: getColor(chess.turn()),
			highlight: {
				lastMove: true,
				check: true,
			},
			premovable: {enabled: false},
			movable: calcMovable(),
			coordinates: true,
		};

		setConfig(previousConfig => ({...previousConfig, ...config}));
		/* eslint-disable-next-line react-hooks/exhaustive-deps */
	}, [puzzle]);

	/**
	 * Allow only legal moves.
	 */
	const calcMovable = useCallback((): Partial<Config['movable']> => {
		const dests = new Map();
		for (const s of chess.SQUARES) {
			const ms = chess.moves({square: s, verbose: true});
			if (ms.length > 0)
				dests.set(
					s,
					ms.map(m => m.to),
				);
		}

		return {
			free: false,
			dests,
			showDests: true,
			color: 'both',
		};
	}, [chess]);

	/**
	 * Function making the computer play the next move.
	 */
	const computerMove = useCallback(
		async (index: number) => {
			if (!chess) return;
			const move = chess.move(moveHistory[index], {sloppy: true});
			if (!move) return;
			setConfig(config => ({
				...config,
				fen: chess.fen(),
				check: chess.in_check(),
				movable: calcMovable(),
				turnColor: getColor(chess.turn()),
				lastMove: [move.from, move.to],
			}));
			setMoveNumber(previousMove => previousMove + 1);
			/* eslint-disable-next-line @typescript-eslint/no-unused-expressions */
			if (hasSound) move.captured ? playCapture() : playMove();
		},
		[chess, moveHistory, calcMovable, hasSound, playCapture, playMove],
	);

	const playFromComputer = useCallback(
		async (move: number) =>
			sleep(300)
				.then(async () => computerMove(move))
				.catch(console.error),
		[computerMove],
	);

	/**
	 * Called after each correct move.
	 */
	const checkPuzzleComplete = useCallback(
		async moveNumber => {
			const isComplete = moveNumber === moveHistory.length;
			if (hasAnimation) {
				const animation = isComplete
					? 'animate-finishMove'
					: 'animate-rightMove';
				setAnimation(() => animation);
				cleanAnimation().catch(console.error);
			}

			if (!isComplete) return playFromComputer(moveNumber);
			setIsRunning(() => false);

			if (hasSound) playGeneric();

			const {timeTaken, timeWithMistakes} = getTime.taken(initialPuzzleTimer);
			const {maxTime, minTime} = getTime.interval(moveHistory.length);

			const newGrade = getGrade({
				didCheat: isSolutionClicked,
				mistakes,
				timeTaken,
				maxTime,
				minTime,
				streak: 0,
			});

			setStat(() => ({
				mistakes,
				time: timeWithMistakes,
				grade: parseGrade[newGrade],
			}));
			setShowModal(() => true);
		},
		/* eslint-disable-next-line react-hooks/exhaustive-deps */
		[
			hasAutoMove,
			hasSound,
			cleanAnimation,
			playFromComputer,
			moveHistory.length,
			mistakes,
			initialPuzzleTimer,
			isSolutionClicked,
		],
	);

	/**
	 * When the board is setup, make the first move.
	 */
	useEffect(() => {
		if (!moveHistory) return;
		if (moveNumber !== 0) return;
		playFromComputer(0).catch(console.error);
	}, [moveHistory, moveNumber, playFromComputer]);

	useEffect(() => {
		setConfig(config => ({...config, lastMove}));
	}, [lastMove]);

	const onRightMove = useCallback(
		async (from: Square, to: Square) => {
			setConfig(config => ({
				...config,
				fen: chess.fen(),
				check: chess.in_check(),
				turnColor: getColor(chess.turn()),
				movable: calcMovable(),
				lastMove: [from, to],
			}));
			const currentMoveNumber = moveNumber + 1;
			setMoveNumber(previousMove => previousMove + 1);
			await checkPuzzleComplete(currentMoveNumber);
		},
		[chess, moveNumber, checkPuzzleComplete, calcMovable],
	);

	const onWrongMove = useCallback(async () => {
		chess.undo();
		setMistakes(previous => previous + 1);
		if (hasAnimation) {
			setAnimation(() => 'animate-wrongMove');
			cleanAnimation().catch(console.error);
		}

		if (hasSound) playError();
		/* eslint-disable-next-line react-hooks/exhaustive-deps */
	}, [chess, hasSound, cleanAnimation]);

	/**
	 * Function called when the user plays.
	 */
	const onMove = useCallback(
		async (from: Square, to: Square) => {
			const moves = chess.moves({verbose: true});
			for (const move_ of moves) {
				if (
					move_.from === from &&
					move_.to === to &&
					move_.flags.includes('p')
				) {
					setPendingMove([from, to]);
					show();
					return;
				}
			}

			const move = chess.move({from, to});
			if (move === null) return;

			/* eslint-disable-next-line @typescript-eslint/no-unused-expressions */
			if (hasSound) move.captured ? playCapture() : playMove();

			const isCorrectMove =
				`${move.from}${move.to}` === moveHistory[moveNumber];
			if (isCorrectMove || chess.in_checkmate()) {
				await onRightMove(from, to);
				return;
			}

			await onWrongMove();
		},
		[
			chess,
			moveHistory,
			moveNumber,
			onRightMove,
			onWrongMove,
			hasSound,
			show,
			playCapture,
			playMove,
		],
	);

	/**
	 * Handle promotions via chessground.
	 */
	const promotion = useCallback(
		async (piece: ShortMove['promotion']) => {
			const from = pendingMove[0];
			const to = pendingMove[1];
			const isCorrectMove = piece === moveHistory[moveNumber].slice(-1);
			const move = chess.move({from, to, promotion: piece});
			if (move === null) return;

			/* eslint-disable-next-line @typescript-eslint/no-unused-expressions */
			if (hasSound) move.captured ? playCapture() : playMove();

			if (isCorrectMove || chess.in_checkmate()) {
				await onRightMove(from, to);
				return;
			}

			await onWrongMove();
		},
		[
			pendingMove,
			moveHistory,
			moveNumber,
			chess,
			hasSound,
			onRightMove,
			onWrongMove,
			playCapture,
			playMove,
		],
	);

	const fn = useCallback(() => {
		router.reload();
	}, [router]);

	const launchTimer = useCallback(() => {
		setIsRunning(() => true);
	}, []);

	useKeyPress({targetKey: 'Q', fn: async () => router.push('/dashboard')});
	useKeyPress({targetKey: 'q', fn: async () => router.push('/dashboard')});
	useKeyPress({targetKey: 'Escape', fn: async () => router.push('/dashboard')});
	useKeyPress({targetKey: 's', fn});
	useKeyPress({targetKey: 'S', fn});
	useKeyPress({targetKey: 'n', fn});
	useKeyPress({targetKey: 'N', fn});

	return (
		<>
			<NextSeo title='⚔️ Play' />
			<ModalPuzzle
				stat={stat}
				puzzle={puzzle}
				showModal={showModal}
				setShowModal={setShowModal}
			/>
			<div className='flex flex-col justify-center w-screen min-h-screen pt-32 pb-24 m-0 text-slate-800'>
				<div className='flex flex-row justify-center gap-2'>
					<Timer value={0} mistakes={mistakes} isRunning={isRunning} />
					<Link href='/dashboard'>
						<a>
							<Button className='items-center my-2 leading-8 bg-gray-800 rounded-md w-36'>
								LEAVE 🧨
							</Button>
						</a>
					</Link>
				</div>
				<div className='flex flex-col items-center justify-center w-full md:flex-row'>
					<div className='hidden w-36 md:invisible md:block' />
					<div className='max-w-[33rem] w-11/12 md:w-full flex-auto'>
						<Board
							// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
							config={{...config, orientation, events: {move: onMove as any}}}
							isOpen={isOpen}
							hide={hide}
							color={getColor(chess.turn())}
							onPromote={promotion}
						/>
						<BottomBar puzzles={[]} />
					</div>

					<div className='flex flex-row justify-center w-5/6 md:w-fit md:flex-col'>
						<div className='mt-2'>
							<Solution
								answer={moveHistory[moveNumber]}
								fen={chess.fen()}
								puzzle={puzzle}
							/>
							<MoveToNext changePuzzle={fn} launchTimer={launchTimer} />
						</div>
					</div>
				</div>
			</div>
		</>
	);
};

PlayingPage.getLayout = (page: ReactElement) => <Layout>{page}</Layout>;
export default PlayingPage;

export const getServerSideProps = withSessionSsr(
	async ({params, req, res}: GetServerSidePropsContext) => {
		const redirect: Redirect = {statusCode: 303, destination: '/'};
		if (!req?.session?.userID) return {redirect};
		const id = params?.id as string | undefined;
		if (!id) return {redirect};
		const protocol = (req.headers['x-forwarded-proto'] as string) || 'http';
		const baseUrl = req ? `${protocol}://${req.headers.host!}` : '';
		const result = await get_.puzzle(id, baseUrl);

		if (!result.success) return {notFound: true};
		res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
		return {props: {puzzle: result.data}};
	},
);
