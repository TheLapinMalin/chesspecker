import {useAtom} from 'jotai';
import type {ChangeEvent} from 'react';
import {optsTitleAtom} from '@/lib/atoms';

export default function OptionTextInput({children}) {
	const [title, setTitle] = useAtom(optsTitleAtom);
	const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
		setTitle(() => event.target.value);
	};

	return (
		<div className='mt-8 flex w-full items-center justify-between overflow-hidden border-2 border-white pb-4 text-left'>
			<label
				htmlFor='number_game'
				className='m-0 mr-4 self-center text-3xl text-white'
			>
				{children}
			</label>
			<input
				id='title'
				className='text-2xl'
				type='text'
				value={title}
				placeholder='ex: Road to 2300 elo :)'
				onChange={handleChange}
			/>
		</div>
	);
}
