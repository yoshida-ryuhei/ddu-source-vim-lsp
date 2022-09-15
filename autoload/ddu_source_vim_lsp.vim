" autoload/ddu_source_vim_lsp.vim

" The definition of debug mode
let s:is_debug_mode = v:false
" The dictionary of cached result
let s:results = {}

function! ddu_source_vim_lsp#debug_mode(...) abort
	" Set debug_mode if specified `is_debug`.
	" Also, get debug_mode if without specified `is_debug`.
	let l:is_debug_mode = get(a:, 1, v:null)
	if ! (l:is_debug_mode is v:null)
		let s:is_debug_mode = l:is_debug_mode
	endif
	return s:is_debug_mode
endfunction

function! ddu_source_vim_lsp#get_list(method,id) abort
	let l:operation = substitute(a:method, '\u', ' \l\0', 'g')
	let l:capabilities_func = printf('lsp#capabilities#has_%s_provider(v:val)', substitute(l:operation, ' ', '_', 'g'))
    let l:servers = filter(lsp#get_allowed_servers(), l:capabilities_func)
	let l:params = {
				\  'context': {'includeDeclaration': v:false},
				\  'textDocument': lsp#get_text_document_identifier(),
				\   'position': lsp#get_position(),
				\ }
	let l:ctx = { 'jump_if_one': v:false}
	let l:command_id = lsp#_new_command()
	let l:ctx = extend({ 'counter': len(l:servers), 'list':[], 'last_command_id': l:command_id, 'jump_if_one': v:true, 'mods': '', 'in_preview': v:false }, l:ctx)
	if len(l:servers) == 0
		return v:false
	endif
	for l:server in l:servers
		call lsp#send_request(l:server, {
					\ 'method': 'textDocument/' . a:method,
					\ 'params': l:params,
					\ 'on_notification': function('s:handle_location', [l:ctx, l:server, l:operation, a:id]),
					\ })
		if s:is_debug_mode
			echomsg 'finish sending requests to '.l:server
		endif
	endfor
	return v:true
endfunction

function! s:handle_location(ctx, server, type, id, data) abort "ctx = {counter, list, last_command_id, jump_if_one, mods, in_preview}
	if a:ctx['last_command_id'] != lsp#_last_command()
		return
	endif
	let a:ctx['counter'] = a:ctx['counter'] - 1
	if lsp#client#is_error(a:data['response']) || !has_key(a:data['response'], 'result')
		call lsp#utils#error('Failed to retrieve '. a:type . ' for ' . a:server . ': ' . lsp#client#error_message(a:data['response']))
	else
		let a:ctx['list'] = a:ctx['list'] + lsp#utils#location#_lsp_to_vim_list(a:data['response']['result'])
	endif
	let s:results[a:id] = a:ctx['list']
endfunction

function! ddu_source_vim_lsp#get_cached(id) abort
	if !has_key(s:results,a:id)
		if s:is_debug_mode
			echomsg 'access to '.a:id.'but failed.'
		endif
		return v:null
	endif
	if s:is_debug_mode
		echomsg 'access to '.a:id.' and ok.'
	endif
	let l:tmp = s:results[a:id]
	call remove(s:results,a:id)
	if s:is_debug_mode
		echomsg l:tmp
	endif
	return l:tmp
endfunction

function! ddu_source_vim_lsp#echo_results() abort
	echomsg s:results
endfunction
