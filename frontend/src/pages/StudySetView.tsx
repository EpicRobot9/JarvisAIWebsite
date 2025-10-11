import React, { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

export default function StudySetView() {
  const { id } = useParams()
  const navigate = useNavigate()
  useEffect(() => {
    if (id) navigate(`/study/sets/${id}/enhanced`, { replace: true })
  }, [id, navigate])
  return null
}
